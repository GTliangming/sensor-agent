import type { ItemInstance, LevelConfig } from "./types";
import { activeBlockers, transitiveBlockers } from "./occlusion";

export type InstanceStatus = "available" | "removed" | "in_collection";
export type SessionStatus = "playing" | "paused" | "rescue" | "completed" | "failed";

export interface ObjectiveProgress {
  itemId: string;
  requiredCount: number;
  collectedCount: number;
  completed: boolean;
}

export interface CollectionSlot {
  instanceId: string;
  itemId: string;
  variantId: string;
}

export type ClickResult =
  | { type: "ignored"; reason: "not_playing" | "not_found" | "not_available" }
  | { type: "blocked"; instanceId: string }
  | {
      type: "collected";
      instanceId: string;
      objectiveIndex: number;
      unlocked: string[];
      levelCompleted: boolean;
    }
  | {
      type: "missed";
      instanceId: string;
      slotIndex: number;
      unlocked: string[];
      storageFull: boolean;
    };

/**
 * 单局玩法状态。纯逻辑，不依赖渲染层，后续迁移到 Cocos 时可直接复用。
 * 进度在点击时立即结算，不依赖动画回调。
 */
export class GameSession {
  readonly level: LevelConfig;
  status: SessionStatus = "playing";
  objectives: ObjectiveProgress[];
  collection: (CollectionSlot | null)[];
  wrongCount = 0;
  rescueUsed = false;
  hintUses = 0;
  /** 当前提示中的实例及剩余高亮时间（秒） */
  hint: { instanceId: string; remaining: number } | null = null;

  private statuses = new Map<string, InstanceStatus>();
  private byId: Map<string, ItemInstance>;
  private idleSeconds = 0;

  constructor(level: LevelConfig) {
    this.level = level;
    this.byId = new Map(level.itemInstances.map((i) => [i.id, i]));
    for (const inst of level.itemInstances) this.statuses.set(inst.id, "available");
    this.objectives = level.objectives.map((o) => ({
      itemId: o.itemId,
      requiredCount: o.requiredCount,
      collectedCount: 0,
      completed: false,
    }));
    this.collection = Array.from(
      { length: level.gridConfig.collectionSlots.capacity },
      () => null,
    );
  }

  statusOf(id: string): InstanceStatus | undefined {
    return this.statuses.get(id);
  }

  inScene = (id: string): boolean => this.statuses.get(id) === "available";

  isBlocked(id: string): boolean {
    const inst = this.byId.get(id);
    return !!inst && activeBlockers(inst, this.inScene).length > 0;
  }

  isClickable(id: string): boolean {
    return this.inScene(id) && !this.isBlocked(id);
  }

  /** 未完成目标的下标，没有则返回 -1 */
  private openObjectiveIndex(itemId: string): number {
    return this.objectives.findIndex((o) => o.itemId === itemId && !o.completed);
  }
  click(id: string): ClickResult {
    if (this.status !== "playing") return { type: "ignored", reason: "not_playing" };
    const inst = this.byId.get(id);
    if (!inst) return { type: "ignored", reason: "not_found" };
    if (!this.inScene(id)) return { type: "ignored", reason: "not_available" };
    if (this.isBlocked(id)) return { type: "blocked", instanceId: id };

    this.idleSeconds = 0;
    if (this.hint?.instanceId === id) this.hint = null;
    const objectiveIndex = this.openObjectiveIndex(inst.itemId);

    if (objectiveIndex >= 0) {
      this.statuses.set(id, "removed");
      const o = this.objectives[objectiveIndex];
      o.collectedCount += 1;
      o.completed = o.collectedCount >= o.requiredCount;
      const levelCompleted = this.objectives.every((x) => x.completed);
      if (levelCompleted) {
        this.status = "completed";
        this.hint = null;
      }
      return {
        type: "collected",
        instanceId: id,
        objectiveIndex,
        unlocked: this.unlockedBy(id),
        levelCompleted,
      };
    }

    // 错误物件：进入归位格（调用时一定有空位，满了会先进入 rescue 状态）
    const slotIndex = this.collection.findIndex((s) => s === null);
    this.statuses.set(id, "in_collection");
    this.collection[slotIndex] = { instanceId: id, itemId: inst.itemId, variantId: inst.variantId };
    this.wrongCount += 1;
    const storageFull = this.collection.every((s) => s !== null);
    if (storageFull) {
      this.status = "rescue";
      this.hint = null;
    }
    return { type: "missed", instanceId: id, slotIndex, unlocked: this.unlockedBy(id), storageFull };
  }

  /** id 被移出场景后，因此变为可点击的实例 */
  private unlockedBy(id: string): string[] {
    return this.level.itemInstances
      .filter((i) => i.blocking.includes(id) && this.isClickable(i.id))
      .map((i) => i.id);
  }

  canRescue(): boolean {
    return this.status === "rescue" && !this.rescueUsed && this.level.gridConfig.adConfig.enabled;
  }

  /** 救场（模拟广告成功后调用）：清空归位格，每局限一次 */
  rescue(): CollectionSlot[] {
    if (!this.canRescue()) return [];
    const cleared = this.collection.filter((s): s is CollectionSlot => s !== null);
    for (const slot of cleared) this.statuses.set(slot.instanceId, "removed");
    this.collection = this.collection.map(() => null);
    this.rescueUsed = true;
    this.status = "playing";
    this.idleSeconds = 0;
    return cleared;
  }

  giveUp(): void {
    if (this.status === "rescue") this.status = "failed";
  }

  pause(): void {
    if (this.status === "playing") this.status = "paused";
  }

  resume(): void {
    if (this.status === "paused") this.status = "playing";
  }
  /** 每帧调用。返回本帧新触发的自动提示实例 ID */
  update(dt: number): string | null {
    if (this.status !== "playing") return null;
    if (this.hint) {
      this.hint.remaining -= dt;
      if (this.hint.remaining <= 0) this.hint = null;
    }
    const { enabled, autoHintSeconds } = this.level.hintConfig;
    if (!enabled || autoHintSeconds <= 0) return null;
    this.idleSeconds += dt;
    if (this.idleSeconds < autoHintSeconds || this.hint) return null;
    this.idleSeconds = 0;
    return this.startHint();
  }

  hintsLeft(): number {
    return Math.max(0, this.level.hintConfig.maxFreeUses - this.hintUses);
  }

  /** 玩家主动使用提示，消耗免费次数 */
  requestHint(): string | null {
    if (this.status !== "playing" || !this.level.hintConfig.enabled) return null;
    if (this.hintsLeft() <= 0) return null;
    const id = this.startHint();
    if (id) this.hintUses += 1;
    return id;
  }

  private startHint(): string | null {
    const id = this.pickHintTarget();
    if (id) this.hint = { instanceId: id, remaining: this.level.hintConfig.highlightDuration };
    return id;
  }

  /** 优先提示可直接点击的目标；目标都被压住时，提示挡住目标的最上层物件 */
  pickHintTarget(): string | null {
    const wanted = this.level.itemInstances.filter(
      (i) => this.inScene(i.id) && this.openObjectiveIndex(i.itemId) >= 0,
    );
    const direct = wanted.find((i) => !this.isBlocked(i.id));
    if (direct) return direct.id;
    for (const target of wanted) {
      for (const b of transitiveBlockers(target.id, this.byId, this.inScene)) {
        if (this.isClickable(b)) return b;
      }
    }
    return null;
  }

  /**
   * 星级按“超出关卡最少必要失误”的次数计算，避免设计上必须放错的关卡永远拿不到 3 星：
   * 用过救场 1 星；没有多余失误 3 星；多余失误不超过 2 次 2 星；其余 1 星。
   */
  stars(requiredWrong = 0): number {
    if (this.status !== "completed") return 0;
    if (this.rescueUsed) return 1;
    const extra = this.wrongCount - requiredWrong;
    if (extra <= 0) return 3;
    return extra <= 2 ? 2 : 1;
  }
}

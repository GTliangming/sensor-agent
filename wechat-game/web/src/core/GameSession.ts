import type { ItemInstance, LevelConfig } from "./types";
import { activeBlockers, transitiveBlockers } from "./occlusion";
import type { LevelSnapshot } from "./save";

export type InstanceStatus = "available" | "removed" | "in_collection";
export type SessionStatus = "playing" | "paused" | "rescue" | "completed" | "failed";

/** 限时挑战：每关倒计时秒数 */
export const TIME_LIMIT_SECONDS = 120;
/** 找对一个目标的基础分；连击每层 +10%，上限 +50% */
export const BASE_SCORE = 100;
const COMBO_STEP = 0.1;
const COMBO_MAX_BONUS = 0.5;

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
      /** 本次找对的得分（含连击加成） */
      scoreGain: number;
      /** 找对后的当前连击数 */
      combo: number;
      /** 累计分数 */
      score: number;
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
 * 计分：找对 100 分起，连续找对每连击 +10%（上限 +50%），点错连击清零、不扣分；星级规则不动。
 * 限时挑战（opts.timed）：每关 120 秒倒计时，超时按失败处理；不改求解器与最少失误数。
 * 断点续玩（opts.snapshot）：从存档快照恢复本局状态。
 */
export class GameSession {
  readonly level: LevelConfig;
  status: SessionStatus = "playing";
  /** 失败原因：timeout（限时到点）或 giveup（归位格满后放弃），其余状态为 null */
  failReason: "timeout" | "giveup" | null = null;
  objectives: ObjectiveProgress[];
  collection: (CollectionSlot | null)[];
  wrongCount = 0;
  rescueUsed = false;
  hintUses = 0;
  /** 当前分数与连击 */
  score = 0;
  combo = 0;
  /** 本局随机目标的种子（null = 设计目标）；断点续玩靠它复现同一局目标 */
  readonly seed: number | null = null;
  /** 限时模式剩余秒数，不限时为 null */
  timeLeft: number | null = null;
  /** 当前提示中的实例及剩余高亮时间（秒） */
  hint: { instanceId: string; remaining: number } | null = null;

  private statuses = new Map<string, InstanceStatus>();
  private byId: Map<string, ItemInstance>;
  private idleSeconds = 0;
  private lastHintId: string | null = null;

  constructor(level: LevelConfig, opts: { timed?: boolean; snapshot?: LevelSnapshot; seed?: number | null } = {}) {
    this.level = level;
    this.seed = opts.seed ?? opts.snapshot?.seed ?? null;
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
    if (opts.timed) this.timeLeft = opts.snapshot?.timeLeft ?? TIME_LIMIT_SECONDS;
    if (opts.snapshot) this.restore(opts.snapshot);
  }

  /** 从中断点快照恢复：已拿走的、归位格里的、提示次数、分数、连击都按快照来 */
  private restore(snap: LevelSnapshot): void {
    const removed = new Set(snap.removed);
    for (const id of removed) if (this.statuses.has(id)) this.statuses.set(id, "removed");
    snap.storage.forEach((id, i) => {
      const inst = this.byId.get(id);
      if (!inst || i >= this.collection.length) return;
      this.statuses.set(id, "in_collection");
      this.collection[i] = { instanceId: id, itemId: inst.itemId, variantId: inst.variantId };
    });
    for (const o of this.objectives) {
      o.collectedCount = [...removed].filter((id) => this.byId.get(id)?.itemId === o.itemId).length;
      o.completed = o.collectedCount >= o.requiredCount;
    }
    this.hintUses = snap.hintUses;
    this.wrongCount = snap.wrongCount;
    this.rescueUsed = snap.rescueUsed;
    this.score = snap.score;
    this.combo = snap.combo;
  }

  /** 当前局面的中断点快照（切后台/退出时保存） */
  snapshot(): LevelSnapshot {
    const removed: string[] = [];
    for (const [id, st] of this.statuses) if (st === "removed") removed.push(id);
    // 归位格按格子顺序排，快照里的 storage 顺序与格子顺序一致
    const orderedStorage = this.collection
      .filter((s): s is CollectionSlot => s !== null)
      .map((s) => s.instanceId);
    return {
      levelId: this.level.id,
      removed,
      storage: orderedStorage,
      hintUses: this.hintUses,
      wrongCount: this.wrongCount,
      rescueUsed: this.rescueUsed,
      score: this.score,
      combo: this.combo,
      ...(this.timeLeft !== null ? { timeLeft: this.timeLeft } : {}),
      ...(this.seed !== null ? { seed: this.seed } : {}),
    };
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
      // 计分：连续找对加连击，每连击 +10%（上限 +50%）
      this.combo += 1;
      const bonus = Math.min(this.combo - 1, 5) * COMBO_STEP;
      const scoreGain = Math.round(BASE_SCORE * (1 + Math.min(bonus, COMBO_MAX_BONUS)));
      this.score += scoreGain;
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
        scoreGain,
        combo: this.combo,
        score: this.score,
      };
    }

    // 错误物件：进入归位格（调用时一定有空位，满了会先进入 rescue 状态），连击清零、不扣分
    const slotIndex = this.collection.findIndex((s) => s === null);
    this.combo = 0;
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
    if (this.status === "rescue") {
      this.status = "failed";
      this.failReason = "giveup";
    }
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
    // 限时挑战：倒计时到 0 按失败处理（可重试），切后台暂停时计时冻结（update 只在 playing 时跑）
    if (this.timeLeft !== null) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.status = "failed";
        this.failReason = "timeout";
        this.hint = null;
        return null;
      }
    }
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

  /** 当前可以直接点击、且还需要的目标实例 */
  clickableTargets(): string[] {
    return this.level.itemInstances
      .filter((i) => this.isClickable(i.id) && this.openObjectiveIndex(i.itemId) >= 0)
      .map((i) => i.id);
  }

  /** 该目标只差最后 1 个时可以免费定位，解决“最后一个怎么也找不到”的问题 */
  canLocateLast(objectiveIndex: number): boolean {
    const o = this.objectives[objectiveIndex];
    return this.status === "playing" && !!o && !o.completed && o.requiredCount - o.collectedCount === 1;
  }

  /**
   * 免费定位最后 1 个目标：能直接点就提示它本身，被压住就提示压在它上面、当前可点的物件。
   * 不消耗主动提示次数。
   */
  locateLast(objectiveIndex: number): string | null {
    if (!this.canLocateLast(objectiveIndex)) return null;
    const itemId = this.objectives[objectiveIndex].itemId;
    const remaining = this.level.itemInstances.filter((i) => i.itemId === itemId && this.inScene(i.id));
    let id = remaining.find((i) => this.isClickable(i.id))?.id ?? null;
    if (!id) {
      for (const inst of remaining) {
        id = [...transitiveBlockers(inst.id, this.byId, this.inScene)].find((b) => this.isClickable(b)) ?? null;
        if (id) break;
      }
    }
    if (id) {
      this.hint = { instanceId: id, remaining: this.level.hintConfig.highlightDuration };
      this.idleSeconds = 0;
    }
    return id;
  }

  /**
   * 优先提示可直接点击的目标；目标都被压住时，提示挡住目标、当前可点的物件。
   * 有多个候选时选离上一次提示最远的，避免每次都提示同一处。
   */
  pickHintTarget(): string | null {
    const wanted = this.level.itemInstances.filter(
      (i) => this.inScene(i.id) && this.openObjectiveIndex(i.itemId) >= 0,
    );
    let candidates = this.clickableTargets();
    if (candidates.length === 0) {
      const gates = new Set<string>();
      for (const target of wanted) {
        for (const b of transitiveBlockers(target.id, this.byId, this.inScene)) {
          if (this.isClickable(b)) gates.add(b);
        }
      }
      candidates = [...gates];
    }
    if (candidates.length === 0) return null;
    const last = this.lastHintId ? this.byId.get(this.lastHintId) : undefined;
    let best = candidates[0];
    if (last) {
      const dist = (id: string) => {
        const p = this.byId.get(id)!.position;
        return Math.hypot(p.x - last.position.x, p.y - last.position.y);
      };
      for (const id of candidates) if (dist(id) > dist(best)) best = id;
    }
    this.lastHintId = best;
    return best;
  }

  /**
   * 星级按“超出关卡必要失误（level.requiredWrong）”的次数计算，避免设计上必须放错的关卡永远拿不到 3 星：
   * 用过救场 1 星；没有多余失误 3 星；多余失误不超过 2 次 2 星；其余 1 星。
   */
  stars(): number {
    if (this.status !== "completed") return 0;
    if (this.rescueUsed) return 1;
    const extra = this.wrongCount - this.level.requiredWrong;
    if (extra <= 0) return 3;
    return extra <= 2 ? 2 : 1;
  }
}

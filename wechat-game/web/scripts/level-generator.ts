import type { ItemConfig, ItemInstance, LevelConfig, SceneConfig } from "../src/core/types";
import { createRng, type Rng } from "../src/core/rng";
import { solveLevel } from "../src/core/solver";
import { MaskLibrary, computeShapeBlocking, type ItemMasksFile } from "../src/core/mask";
import masksFile from "../src/data/item_masks.json";
import type { LevelSpec } from "./level-specs";
import { ancestorsOf, buildPile, type PileCell } from "./pile-geometry";
import { SCENE_RECT } from "../src/layout";

// 关卡生成：先按物品堆形状铺满并叠放（几何决定遮挡），再给每个格子分配物件身份。
// 分配时保证：被压住的目标，其上方的全部物件要么也是目标，要么是本关的“门槛干扰物”，
// 门槛干扰物数量恰好等于 requiredWrong，因此不看广告也一定能通关。

interface Roles {
  targets: number[];
  gates: Set<number>;
}

/** 埋目标时每多占用一个目标名额，相当于少了多少设计像素的分散度 */
const BURY_COST_WEIGHT = 220;

function assignRoles(cells: PileCell[], spec: LevelSpec, rng: Rng): Roles | null {
  const targetTotal = spec.targets.reduce((sum, [, n]) => sum + n, 0);
  const ancestors = cells.map((c) => ancestorsOf(c, cells));
  const T = new Set<number>();
  const G = new Set<number>();
  const buriedNeeded = Math.ceil(spec.buriedTargetRatio * targetTotal);
  const isBuried = (i: number) => cells[i].blockers.length > 0;

  // 离已选目标越远越优先，避免目标扎堆、拿完后中间空出一大片。加一点随机避免每关同一种分布
  const spreadScore = (...group: number[]) => {
    let min = Infinity;
    for (const i of group) {
      for (const t of T) min = Math.min(min, Math.hypot(cells[i].x - cells[t].x, cells[i].y - cells[t].y));
    }
    return (min === Infinity ? 0 : min) + rng.range(0, 60);
  };

  // 先埋目标：每次在“埋得起”（上方物件能全部变成目标或门槛）的候选里选最分散的一个
  const lower = cells.filter((c) => isBuried(c.index)).map((c) => c.index);
  while ([...T].filter(isBuried).length < buriedNeeded) {
    const options = lower
      .filter((c) => !T.has(c) && !G.has(c))
      .map((c) => {
        const fresh = [...ancestors[c]].filter((i) => !T.has(i) && !G.has(i));
        const nGates = Math.min(spec.requiredWrong - G.size, fresh.length);
        return { c, fresh, nGates, ok: fresh.length - nGates <= targetTotal - T.size - 1 };
      })
      .filter((o) => o.ok);
    if (options.length === 0) return null;
    // 分散度按“这次会新增的全部目标”（被埋的格子 + 要一起变成目标的上方物件）计算，
    // 并与代价权衡：代价太高会把目标名额用光
    const best = pickMax(options, (o) => {
      const newTargets = [o.c, ...o.fresh.slice(o.nGates)];
      return spreadScore(...newTargets) - BURY_COST_WEIGHT * (o.fresh.length - o.nGates);
    });
    const fresh = rng.shuffle(best.fresh);
    fresh.slice(0, best.nGates).forEach((i) => G.add(i));
    fresh.slice(best.nGates).forEach((i) => T.add(i));
    T.add(best.c);
  }
  if (G.size !== spec.requiredWrong) return null;

  // 剩余目标放在“上方物件全是目标或门槛”的格子里，同样按分散度挑
  const free = () =>
    cells
      .map((c) => c.index)
      .filter((i) => !T.has(i) && !G.has(i) && [...ancestors[i]].every((a) => T.has(a) || G.has(a)));
  while (T.size < targetTotal) {
    const options = free();
    if (options.length === 0) return null;
    T.add(pickMax(options, spreadScore));
  }
  return { targets: rng.shuffle([...T]), gates: G };
}

/** 每个候选只打一次分，取分数最高者 */
function pickMax<T>(list: T[], score: (x: T) => number): T {
  let best = list[0];
  let bestScore = -Infinity;
  for (const x of list) {
    const s = score(x);
    if (s > bestScore) {
      best = x;
      bestScore = s;
    }
  }
  return best;
}

function buildInstances(
  cells: PileCell[],
  roles: Roles,
  spec: LevelSpec,
  items: Map<string, ItemConfig>,
  rng: Rng,
): ItemInstance[] {
  const itemOf = new Map<number, string>();
  let cursor = 0;
  for (const [itemId, count] of spec.targets) {
    for (let k = 0; k < count; k++) itemOf.set(roles.targets[cursor++], itemId);
  }
  const pool = rng.shuffle([...spec.distractors]);
  let d = 0;
  for (const c of cells) if (!itemOf.has(c.index)) itemOf.set(c.index, pool[d++ % pool.length]);

  const counters = new Map<string, number>();
  const ids = cells.map((c) => {
    const itemId = itemOf.get(c.index)!;
    const n = (counters.get(itemId) ?? 0) + 1;
    counters.set(itemId, n);
    return `${itemId}_${String(n).padStart(3, "0")}`;
  });

  return cells.map((c) => {
    const item = items.get(itemOf.get(c.index)!);
    if (!item) throw new Error(`物件 ${itemOf.get(c.index)} 未登记`);
    return {
      id: ids[c.index],
      itemId: item.id,
      variantId: rng.pick(item.variants).id,
      position: { x: Math.round(c.x), y: Math.round(c.y) },
      rotation: c.rotation,
      // 物品堆内统一格子尺寸，scale 把物件原始尺寸换算到格子尺寸
      scale: Math.round((spec.pile.tile / item.size.width) * 1000) / 1000,
      layer: c.layer,
      zone: "pile",
      blocking: c.blockers.map((b) => ids[b]).sort(),
    };
  });
}
function toLevel(spec: LevelSpec, instances: ItemInstance[], scene: SceneConfig, items: Map<string, ItemConfig>): LevelConfig {
  const pad = (n: number) => `level_${String(n).padStart(3, "0")}`;
  return {
    id: pad(spec.number),
    chapterId: "chapter_01",
    levelNumber: spec.number,
    name: spec.name,
    sceneId: scene.id,
    difficulty: spec.number,
    teaching: spec.teaching,
    requiredWrong: 0, // 求解后回填
    designResolution: { ...scene.designResolution },
    objectives: spec.targets.map(([itemId, requiredCount]) => ({
      itemId,
      requiredCount,
      displayVariant: items.get(itemId)!.defaultVariantId,
    })),
    itemInstances: instances,
    gridConfig: {
      targetSlots: { baseCount: spec.targets.length, maxCount: spec.targets.length },
      collectionSlots: { capacity: spec.capacity },
      adConfig: { enabled: true, simulated: true },
    },
    hintConfig: { enabled: true, autoHintSeconds: spec.autoHintSeconds, maxFreeUses: 3, highlightDuration: 2.5 },
    completionConfig: {
      requireAllObjectivesCompleted: true,
      nextLevelId: spec.number < 10 ? pad(spec.number + 1) : undefined,
    },
  };
}

/** 各类失败原因的计数，生成失败时输出，便于调整关卡规格 */
const failures = { roles: 0, solve: 0, tooMany: 0, buried: 0, spread: 0 };

function tryGenerate(spec: LevelSpec, items: Map<string, ItemConfig>, scene: SceneConfig, rng: Rng): LevelConfig | null {
  const cells = buildPile(spec.pile, rng);
  const roles = assignRoles(cells, spec, rng);
  if (!roles) return failures.roles++, null;
  const instances = buildInstances(cells, roles, spec, items, rng);
  // 粗排用的是方块近似，身份确定后按图标真实形状重算遮挡
  applyShapeBlocking(instances, items);
  const level = toLevel(spec, instances, scene, items);
  const solved = solveLevel(level);
  // 按真实轮廓重算后，个别门槛干扰物可能实际没压住目标，允许比规格少 1 次必要失误
  const wrongOk = solved.minWrong <= spec.requiredWrong && solved.minWrong >= Math.max(0, spec.requiredWrong - 1);
  if (!solved.completable || !wrongOk) {
    if (solved.minWrong > spec.requiredWrong) failures.tooMany++;
    return failures.solve++, null;
  }
  const targetIds = new Set(spec.targets.map(([id]) => id));
  const targets = instances.filter((i) => targetIds.has(i.itemId));
  const buried = targets.filter((i) => i.blocking.length > 0).length / targets.length;
  if (buried < spec.buriedTargetRatio) return failures.buried++, null;
  if (targetSpread(targets) < MIN_TARGET_SPREAD) return failures.spread++, null;
  level.requiredWrong = solved.minWrong;
  return level;
}

/** 物品区 3×3 宫格里至少有这么多格出现目标，避免目标扎堆 */
const MIN_TARGET_SPREAD = 5;

/** 有目标出现的宫格数（物品区切成 3×3） */
export function targetSpread(targets: ItemInstance[]): number {
  return new Set(
    targets.map((t) => {
      const col = Math.min(2, Math.max(0, Math.floor(((t.position.x - SCENE_RECT.x) / SCENE_RECT.width) * 3)));
      const row = Math.min(2, Math.max(0, Math.floor(((t.position.y - SCENE_RECT.y) / SCENE_RECT.height) * 3)));
      return row * 3 + col;
    }),
  ).size;
}

const MASKS = new MaskLibrary(masksFile as ItemMasksFile);

/** 按图标真实轮廓重算 blocking（与配置校验、运行时点击用同一份掩码和同一个尺寸算法） */
function applyShapeBlocking(instances: ItemInstance[], items: Map<string, ItemConfig>): void {
  const blocking = computeShapeBlocking(instances, (i) => items.get(i.itemId)!.size.width * i.scale, MASKS);
  for (const inst of instances) inst.blocking = blocking.get(inst.id)!;
}

/** 从 baseSeed 开始逐个尝试种子，返回第一个满足规格的关卡及其种子 */
export function generateLevel(
  spec: LevelSpec,
  items: Map<string, ItemConfig>,
  scene: SceneConfig,
  baseSeed: number,
  maxTries = 20000,
): { level: LevelConfig; seed: number } {
  failures.roles = failures.solve = failures.tooMany = failures.buried = failures.spread = 0;
  for (let i = 0; i < maxTries; i++) {
    const seed = baseSeed + i;
    const level = tryGenerate(spec, items, scene, createRng(seed));
    if (level) return { level, seed };
  }
  throw new Error(
    `关卡 ${spec.number} 在 ${maxTries} 次尝试内未生成满足规格的布局（失败原因计数：` +
      `分配目标 ${failures.roles}，失误数/可完成 ${failures.solve}（其中失误过多 ${failures.tooMany}），埋住比例 ${failures.buried}，目标分散度 ${failures.spread}）`,
  );
}

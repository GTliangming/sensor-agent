import { transitiveBlockers } from "./occlusion";
import { createRng, type Rng } from "./rng";
import { solveLevel } from "./solver";
import type { LevelConfig, Objective } from "./types";

/** 每次进关用的随机种子（31 位正整数） */
export function freshSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

/** e2e 用的固定种子：同一关每次跑同一局目标，浏览器测试可复现 */
export function e2eSeed(levelNumber: number): number {
  return levelNumber * 7919 + 2;
}

/** 随机目标的必要失误上限：与设计关卡同一档（设计值最高 3，归位格容量 4） */
const MAX_MIN_WRONG = 3;
const MAX_ATTEMPTS = 400;
/** 随机目标总数不低于设计总数的 60%，避免某局太短 */
const MIN_TOTAL_RATIO = 0.6;

/** 每种物件的“被埋程度”：该种实例的平均传递遮挡者数（越小越在上面、越好找） */
function kindBuriedness(level: LevelConfig): Map<string, number> {
  const byId = new Map(level.itemInstances.map((i) => [i.id, i]));
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  for (const inst of level.itemInstances) {
    const n = transitiveBlockers(inst.id, byId).size;
    sum.set(inst.itemId, (sum.get(inst.itemId) ?? 0) + n);
    count.set(inst.itemId, (count.get(inst.itemId) ?? 0) + 1);
  }
  const out = new Map<string, number>();
  for (const [k, s] of sum) out.set(k, s / (count.get(k) ?? 1));
  return out;
}

/** 按权重无放回抽取 n 种（权重越高越容易抽中，但每种都有机会） */
function weightedPickKinds(
  rng: Rng,
  kinds: string[],
  weight: (k: string) => number,
  n: number,
): string[] {
  const pool = [...kinds];
  const picked: string[] = [];
  while (picked.length < n && pool.length > 0) {
    let total = 0;
    for (const k of pool) total += weight(k);
    let roll = rng.next() * total;
    let idx = 0;
    for (; idx < pool.length; idx++) {
      roll -= weight(pool[idx]);
      if (roll <= 0) break;
    }
    picked.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]);
  }
  return picked;
}

/**
 * 每进一次关，目标重新随机抽取：同一关每次玩要找的东西都不一样。
 * 只换“找什么”，不换难度骨架——目标种类数沿用设计值（找寻格数量不变），
 * 总数尽量贴近设计总数（每种至少 1 个，按该种在场景里的数量封顶）。
 * 抽完用求解器验算：必须可通关、必要失误不超过 3（否则重抽）；60 次都抽不到就回落到设计目标。
 * 给定同一 (level, seed) 结果完全确定，断点续玩靠快照里的种子复现同一局目标。
 */
export function randomizeObjectives(level: LevelConfig, seed: number): LevelConfig {
  const rng = createRng(seed);
  const available = new Map<string, number>();
  for (const inst of level.itemInstances) {
    available.set(inst.itemId, (available.get(inst.itemId) ?? 0) + 1);
  }
  const kindCount = level.objectives.length;
  const total = level.objectives.reduce((n, o) => n + o.requiredCount, 0);
  const minTotal = Math.max(kindCount, Math.ceil(total * MIN_TOTAL_RATIO));
  const buried = kindBuriedness(level);
  // 好找的种类权重高（埋得浅的目标更容易凑出“必要失误 ≤ 3”的合法局），
  // 但每种都有机会被抽中，局与局之间仍不一样
  const weight = (k: string) => 1 / (1 + (buried.get(k) ?? 0));

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const kinds = weightedPickKinds(rng, [...available.keys()], weight, kindCount);
    // 每种先 1 个，剩余尽量均分（每轮补给当前最少的、还有余量的种类），
    // 数量越均匀，每种要挖的实例越少，越容易凑出“必要失误 ≤ 3”的合法局
    const counts = new Map<string, number>(kinds.map((k) => [k, 1]));
    let remaining = total - kindCount;
    while (remaining > 0) {
      const roomy = kinds.filter((k) => (counts.get(k) ?? 0) < (available.get(k) ?? 0));
      if (roomy.length === 0) break;
      const minCount = Math.min(...roomy.map((k) => counts.get(k)!));
      const lowest = roomy.filter((k) => counts.get(k) === minCount);
      const k = rng.pick(lowest);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      remaining--;
    }
    const sum = [...counts.values()].reduce((a, b) => a + b, 0);
    if (sum < minTotal) continue;
    const picked: Objective[] = [...counts.entries()].map(([itemId, requiredCount]) => ({
      itemId,
      requiredCount,
    }));
    const candidate: LevelConfig = { ...level, objectives: picked, requiredWrong: level.requiredWrong };
    const solved = solveLevel(candidate);
    if (!solved.completable) continue;
    if (solved.minWrong > MAX_MIN_WRONG) continue;
    if (solved.minWrong >= level.gridConfig.collectionSlots.capacity) continue;
    return { ...candidate, requiredWrong: solved.minWrong };
  }
  return level;
}

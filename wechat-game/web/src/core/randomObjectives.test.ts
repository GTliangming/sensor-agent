import { describe, expect, it } from "vitest";
import { LEVELS } from "../data/all-levels";
import { GameSession } from "./GameSession";
import { freshSeed, randomizeObjectives } from "./randomObjectives";
import { solveLevel } from "./solver";

describe("每进一次关目标随机", () => {
  it("同一 (关卡, 种子) 结果完全确定", () => {
    for (const level of LEVELS) {
      const a = randomizeObjectives(level, 12345);
      const b = randomizeObjectives(level, 12345);
      expect(a.objectives).toEqual(b.objectives);
      expect(a.requiredWrong).toBe(b.requiredWrong);
    }
  });

  it("不同种子会抽出不同目标（不是换皮固定）", () => {
    for (const level of LEVELS) {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 12; seed++) {
        const r = randomizeObjectives(level, seed);
        seen.add(r.objectives.map((o) => `${o.itemId}x${o.requiredCount}`).join(","));
      }
      // 12 个种子至少抽出 3 种不同目标组合
      expect(seen.size).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))(
    "%s 随机目标始终可通关、星级口径一致",
    (_, level) => {
      const available = new Map<string, number>();
      for (const inst of level.itemInstances) {
        available.set(inst.itemId, (available.get(inst.itemId) ?? 0) + 1);
      }
      for (let seed = 1; seed <= 15; seed++) {
        const r = randomizeObjectives(level, seed);
        // 目标种类数沿用设计值（找寻格数量不变），只换“找什么”；总数贴近设计总数
        expect(r.objectives).toHaveLength(level.objectives.length);
        const total = r.objectives.reduce((n, o) => n + o.requiredCount, 0);
        const designedTotal = level.objectives.reduce((n, o) => n + o.requiredCount, 0);
        expect(total).toBeGreaterThanOrEqual(
          Math.max(level.objectives.length, Math.ceil(designedTotal * 0.6)),
        );
        expect(total).toBeLessThanOrEqual(designedTotal);
        // 种类不重复、数量不超过场景里有的个数
        const kinds = r.objectives.map((o) => o.itemId);
        expect(new Set(kinds).size).toBe(kinds.length);
        for (const o of r.objectives) {
          expect(o.requiredCount).toBeLessThanOrEqual(available.get(o.itemId) ?? 0);
        }
        // 求解器验算：可通关、必要失误与星级口径一致、不超过设计档
        const solved = solveLevel(r);
        expect(solved.completable).toBe(true);
        expect(solved.minWrong).toBe(r.requiredWrong);
        expect(solved.minWrong).toBeLessThanOrEqual(3);
        expect(solved.minWrong).toBeLessThan(level.gridConfig.collectionSlots.capacity);
      }
    },
  );

  it("种子随快照保存，断点续玩能复现同一局目标", () => {
    const level = LEVELS[0];
    const seed = 777;
    const playLevel = randomizeObjectives(level, seed);
    const session = new GameSession(playLevel, { seed });
    expect(session.seed).toBe(seed);
    // 找对一个目标后保存快照，种子还在
    const target = session.clickableTargets()[0];
    session.click(target);
    const snap = session.snapshot();
    expect(snap.seed).toBe(seed);
    // 用同一局目标 + 快照恢复，目标与进度一致
    const resumed = new GameSession(randomizeObjectives(level, snap.seed!), { snapshot: snap });
    expect(resumed.seed).toBe(seed);
    expect(resumed.objectives.map((o) => o.itemId)).toEqual(
      session.objectives.map((o) => o.itemId),
    );
    expect(resumed.objectives[0].collectedCount).toBe(session.objectives[0].collectedCount);
  });

  it("freshSeed 每次不同", () => {
    const seeds = new Set(Array.from({ length: 20 }, () => freshSeed()));
    expect(seeds.size).toBeGreaterThan(15);
  });
});

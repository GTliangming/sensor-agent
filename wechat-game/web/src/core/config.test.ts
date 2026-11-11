import { describe, expect, it } from "vitest";
import { CONFIG_BUNDLE, ITEM_MAP, LEVELS } from "../data";
import masksFile from "../data/item_masks.json";
import { decodeMask, shapeContains, shapePoints, type ItemMasksFile } from "./mask";
import { solveLevel } from "./solver";
import { validateBundle } from "./validator";
import { defaultSave, loadSave, recordCompletion } from "./save";
import type { LevelConfig } from "./types";

describe("第一章配置", () => {
  it("共 10 关且全部通过校验", () => {
    expect(LEVELS).toHaveLength(10);
    expect(validateBundle(CONFIG_BUNDLE).errors).toEqual([]);
  });

  it.each(LEVELS.map((l) => [l.id, l] as const))("%s 不看广告可以通关", (_, level) => {
    const r = solveLevel(level);
    expect(r.completable).toBe(true);
    expect(r.minWrong).toBeLessThan(level.gridConfig.collectionSlots.capacity);
  });

  it("遮挡关系与图标真实形状一致：被标记遮挡的确实被盖住，没标记的确实没被盖住", () => {
    const masks = masksFile as ItemMasksFile;
    for (const level of LEVELS) {
      const shapes = new Map(
        level.itemInstances.map((i) => [
          i.id,
          {
            x: i.position.x,
            y: i.position.y,
            rotation: i.rotation,
            tile: ITEM_MAP.get(i.itemId)!.size.width * i.scale,
            mask: decodeMask(masks.masks[i.itemId], masks.size),
          },
        ]),
      );
      for (const inst of level.itemInstances) {
        const points = shapePoints(shapes.get(inst.id)!, masks.size);
        for (const other of level.itemInstances.filter((o) => o.layer > inst.layer)) {
          const covered = points.filter((p) => shapeContains(shapes.get(other.id)!, p.x, p.y, masks.size)).length;
          expect(covered >= 3, `${level.id} ${other.id} → ${inst.id} 覆盖 ${covered} 点`).toBe(inst.blocking.includes(other.id));
        }
      }
    }
  });

  it("多层关卡里确实有被压住的目标", () => {
    for (const level of LEVELS.filter((l) => l.levelNumber >= 3)) {
      const targets = new Set(level.objectives.map((o) => o.itemId));
      const buried = level.itemInstances.filter((i) => targets.has(i.itemId) && i.blocking.length > 0);
      expect(buried.length, level.id).toBeGreaterThan(0);
    }
  });
});

describe("校验器能发现错误配置", () => {
  const base = structuredClone(LEVELS[2]);
  const errorsOf = (level: LevelConfig) =>
    validateBundle({ ...CONFIG_BUNDLE, levels: CONFIG_BUNDLE.levels.map((l) => (l.id === level.id ? level : l)) }).errors;

  it("实例 ID 重复", () => {
    const l = structuredClone(base);
    l.itemInstances[1].id = l.itemInstances[0].id;
    expect(errorsOf(l).join()).toContain("实例 ID 重复");
  });

  it("遮挡引用不存在、自引用、成环", () => {
    const l = structuredClone(base);
    l.itemInstances[0].blocking = ["ghost"];
    expect(errorsOf(l).join()).toContain("不存在");
    l.itemInstances[0].blocking = [l.itemInstances[0].id];
    expect(errorsOf(l).join()).toContain("遮挡了自己");
    l.itemInstances[0].blocking = [l.itemInstances[1].id];
    l.itemInstances[1].blocking = [l.itemInstances[0].id];
    expect(errorsOf(l).join()).toContain("成环");
  });

  it("目标数量多于场景实例", () => {
    const l = structuredClone(base);
    l.objectives[0].requiredCount = 99;
    expect(errorsOf(l).join()).toContain("场景中只有");
  });

  it("引用未登记的物件和变体", () => {
    const l = structuredClone(base);
    l.itemInstances[0].itemId = "unknown_item";
    l.itemInstances[1].variantId = "nope";
    const msg = errorsOf(l).join();
    expect(msg).toContain("不存在的物件");
    expect(msg).toContain("变体");
  });
});

describe("存档", () => {
  const mem = (raw: string | null) => ({ getItem: () => raw, setItem: () => {} });

  it("存档损坏或版本不符时恢复默认", () => {
    expect(loadSave(mem("{oops"))).toEqual(defaultSave());
    expect(loadSave(mem(JSON.stringify({ version: 9 })))).toEqual(defaultSave());
  });

  it("通关解锁下一关并保留最好星级", () => {
    let s = recordCompletion(defaultSave(), "level_001", 1, 3);
    s = recordCompletion(s, "level_001", 1, 1);
    expect(s.unlockedLevel).toBe(2);
    expect(s.stars.level_001).toBe(3);
    expect(s.completedLevels).toEqual(["level_001"]);
  });
});

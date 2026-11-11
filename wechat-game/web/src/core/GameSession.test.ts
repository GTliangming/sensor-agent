import { describe, expect, it } from "vitest";
import { GameSession } from "./GameSession";
import type { ItemInstance, LevelConfig } from "./types";

function inst(id: string, itemId: string, blocking: string[] = []): ItemInstance {
  return { id, itemId, variantId: "default", position: { x: 500, y: 800 }, rotation: 0, scale: 1, layer: 0, zone: "floor", blocking };
}

function level(instances: ItemInstance[], capacity = 3): LevelConfig {
  return {
    id: "level_test", chapterId: "chapter_01", levelNumber: 1, name: "测试", sceneId: "s", difficulty: 1, teaching: "",
    designResolution: { width: 1080, height: 1920 },
    objectives: [{ itemId: "earphone", requiredCount: 2 }],
    itemInstances: instances,
    gridConfig: { targetSlots: { baseCount: 1, maxCount: 1 }, collectionSlots: { capacity }, adConfig: { enabled: true, simulated: true } },
    hintConfig: { enabled: true, autoHintSeconds: 5, maxFreeUses: 1, highlightDuration: 2 },
    completionConfig: { requireAllObjectivesCompleted: true },
  };
}

describe("GameSession 拾取", () => {
  it("正确物件增加进度且不占归位格，重复点击不重复结算", () => {
    const s = new GameSession(level([inst("e1", "earphone"), inst("e2", "earphone")]));
    expect(s.click("e1").type).toBe("collected");
    expect(s.click("e1")).toEqual({ type: "ignored", reason: "not_available" });
    expect(s.objectives[0].collectedCount).toBe(1);
    expect(s.collection.every((c) => c === null)).toBe(true);
  });

  it("找齐全部目标后通关，通关后不能继续点击", () => {
    const s = new GameSession(level([inst("e1", "earphone"), inst("e2", "earphone"), inst("k", "key")]));
    s.click("e1");
    const r = s.click("e2");
    expect(r.type === "collected" && r.levelCompleted).toBe(true);
    expect(s.status).toBe("completed");
    expect(s.click("k").type).toBe("ignored");
    expect(s.stars()).toBe(3);
  });

  it("错误物件进入归位格，填满后进入救场，救场清空归位格且只能用一次", () => {
    const s = new GameSession(level([inst("e1", "earphone"), inst("e2", "earphone"), inst("a", "key"), inst("b", "pen"), inst("c", "cup"), inst("d", "tissue")], 2));
    expect(s.click("a")).toMatchObject({ type: "missed", slotIndex: 0, storageFull: false });
    expect(s.click("b")).toMatchObject({ type: "missed", slotIndex: 1, storageFull: true });
    expect(s.status).toBe("rescue");
    expect(s.click("e1").type).toBe("ignored");
    expect(s.rescue()).toHaveLength(2);
    expect(s.status).toBe("playing");
    s.click("c");
    s.click("d");
    expect(s.canRescue()).toBe(false);
    s.giveUp();
    expect(s.status).toBe("failed");
  });
});

describe("GameSession 遮挡", () => {
  it("被多个物件遮挡时，全部遮挡者移除后才解锁", () => {
    const s = new GameSession(level([inst("e1", "earphone", ["a", "e2"]), inst("e2", "earphone"), inst("a", "key")]));
    expect(s.click("e1")).toEqual({ type: "blocked", instanceId: "e1" });
    expect(s.click("e2")).toMatchObject({ unlocked: [] });
    expect(s.click("a")).toMatchObject({ type: "missed", unlocked: ["e1"] });
    expect(s.click("e1").type).toBe("collected");
    expect(s.stars()).toBe(2);
    expect(s.stars(1)).toBe(3);
  });
});

describe("GameSession 提示", () => {
  it("无操作达到间隔后自动提示被压住目标的遮挡者，点击会重置计时", () => {
    const s = new GameSession(level([inst("e1", "earphone", ["a"]), inst("e2", "earphone"), inst("a", "key")]));
    expect(s.update(4)).toBeNull();
    s.click("e2");
    expect(s.update(4)).toBeNull();
    expect(s.update(1.5)).toBe("a");
    expect(s.hint?.instanceId).toBe("a");
  });

  it("主动提示消耗免费次数，用完后不再提示", () => {
    const s = new GameSession(level([inst("e1", "earphone"), inst("e2", "earphone")]));
    expect(s.requestHint()).toBe("e1");
    expect(s.hintsLeft()).toBe(0);
    expect(s.requestHint()).toBeNull();
  });
});

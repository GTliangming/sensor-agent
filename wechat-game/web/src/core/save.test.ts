import { describe, expect, it } from "vitest";
import {
  clearProgress,
  defaultSave,
  loadSave,
  recordCompletion,
  saveProgress,
  type LevelSnapshot,
  type SaveData,
} from "./save";

const mem = (raw: string | null) => {
  let value = raw;
  return {
    getItem: () => value,
    setItem: (_k: string, v: string) => {
      value = v;
    },
  };
};

const snap: LevelSnapshot = {
  levelId: "level_003",
  removed: ["milk_tea_cup_001"],
  storage: ["key_002"],
  hintUses: 1,
  wrongCount: 1,
  rescueUsed: false,
  score: 210,
  combo: 2,
};

describe("存档 v2", () => {
  it("v1 存档原地升级为 v2：保留星级与解锁，不丢老进度", () => {
    const v1 = JSON.stringify({
      version: 1,
      chapterId: "chapter_01",
      unlockedLevel: 3,
      completedLevels: ["level_001"],
      stars: { level_001: 2 },
      settings: { soundEnabled: false },
    });
    const s = loadSave(mem(v1));
    expect(s.version).toBe(2);
    expect(s.unlockedLevel).toBe(3);
    expect(s.completedLevels).toEqual(["level_001"]);
    expect(s.stars.level_001).toBe(2);
    expect(s.bestScores).toEqual({});
    expect(s.inProgress).toBeNull();
    expect(s.settings).toEqual({ soundEnabled: false, timedChallenge: false });
  });

  it("v2 快照能存能读，损坏的快照回 null、不影响其他进度", () => {
    const storage = mem(null);
    let s = defaultSave();
    s = saveProgress(s, snap);
    const { setItem } = storage;
    setItem("yiwubainian.save", JSON.stringify(s));
    expect(loadSave(storage).inProgress).toEqual(snap);
    const bad = { ...s, inProgress: { levelId: "level_003", removed: "not-an-array" } };
    setItem("yiwubainian.save", JSON.stringify(bad));
    const loaded = loadSave(storage);
    expect(loaded.inProgress).toBeNull();
    expect(loaded.unlockedLevel).toBe(1);
  });

  it("通关记最高分（只升不降）并清除本关中断点", () => {
    let s: SaveData = saveProgress(defaultSave(), snap);
    s = recordCompletion(s, "level_003", 3, 2, 300);
    expect(s.bestScores.level_003).toBe(300);
    expect(s.inProgress).toBeNull();
    s = recordCompletion(s, "level_003", 3, 3, 150);
    expect(s.bestScores.level_003).toBe(300);
    expect(s.stars.level_003).toBe(3);
  });

  it("重新开始清除中断点", () => {
    const s = clearProgress(saveProgress(defaultSave(), snap));
    expect(s.inProgress).toBeNull();
  });
});

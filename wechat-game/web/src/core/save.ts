export interface SaveData {
  version: 1;
  chapterId: string;
  /** 已解锁的最大关卡序号（从 1 开始） */
  unlockedLevel: number;
  completedLevels: string[];
  stars: Record<string, number>;
  settings: { soundEnabled: boolean };
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "yiwubainian.save";

export function defaultSave(): SaveData {
  return {
    version: 1,
    chapterId: "chapter_01",
    unlockedLevel: 1,
    completedLevels: [],
    stars: {},
    settings: { soundEnabled: true },
  };
}

/** 读取存档；不存在、损坏或版本不符时返回默认存档 */
export function loadSave(storage: SaveStorage): SaveData {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as Partial<SaveData>;
    if (data.version !== 1 || typeof data.unlockedLevel !== "number") return defaultSave();
    return {
      ...defaultSave(),
      ...data,
      completedLevels: Array.isArray(data.completedLevels) ? data.completedLevels : [],
      stars: data.stars && typeof data.stars === "object" ? data.stars : {},
    } as SaveData;
  } catch {
    return defaultSave();
  }
}

export function writeSave(storage: SaveStorage, data: SaveData): void {
  try {
    storage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 存储不可用（隐私模式等）时不阻塞游戏
  }
}

/** 通关后更新存档：记录星级（保留最好成绩）并解锁下一关 */
export function recordCompletion(
  save: SaveData,
  levelId: string,
  levelNumber: number,
  stars: number,
): SaveData {
  return {
    ...save,
    unlockedLevel: Math.max(save.unlockedLevel, levelNumber + 1),
    completedLevels: save.completedLevels.includes(levelId)
      ? save.completedLevels
      : [...save.completedLevels, levelId],
    stars: { ...save.stars, [levelId]: Math.max(save.stars[levelId] ?? 0, stars) },
  };
}

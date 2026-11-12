/** 关卡中断点快照：切后台/退出时保存，重进该关可“继续”。 */
export interface LevelSnapshot {
  levelId: string;
  /** 已从场景拿走的实例 ID（目标 + 救场清空的归位格物件） */
  removed: string[];
  /** 归位格里的实例 ID（按格子顺序） */
  storage: string[];
  hintUses: number;
  wrongCount: number;
  rescueUsed: boolean;
  score: number;
  combo: number;
  /** 限时模式剩余秒数（不限时为空） */
  timeLeft?: number;
  /** 随机目标的种子：有则进关时用它复现同一局目标，没有时用设计目标（老存档兼容） */
  seed?: number;
}

export interface SaveData {
  version: 2;
  chapterId: string;
  /** 已解锁的最大关卡序号（从 1 开始） */
  unlockedLevel: number;
  completedLevels: string[];
  stars: Record<string, number>;
  /** 每关历史最高分 */
  bestScores: Record<string, number>;
  /** 未完成的中断点快照，没有时为 null */
  inProgress: LevelSnapshot | null;
  settings: { soundEnabled: boolean; timedChallenge: boolean };
}

export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "yiwubainian.save";

export function defaultSave(): SaveData {
  return {
    version: 2,
    chapterId: "chapter_01",
    unlockedLevel: 1,
    completedLevels: [],
    stars: {},
    bestScores: {},
    inProgress: null,
    settings: { soundEnabled: true, timedChallenge: false },
  };
}

function isValidSnapshot(data: unknown): data is LevelSnapshot {
  if (!data || typeof data !== "object") return false;
  const s = data as Partial<LevelSnapshot>;
  return (
    typeof s.levelId === "string" &&
    Array.isArray(s.removed) &&
    Array.isArray(s.storage) &&
    typeof s.hintUses === "number" &&
    typeof s.score === "number"
  );
}

/**
 * 读取存档；不存在、损坏或版本不符时返回默认存档。
 * v1 存档原地升级为 v2：保留星级与解锁，bestScores 为空、inProgress 为空，不丢老进度。
 */
export function loadSave(storage: SaveStorage): SaveData {
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return defaultSave();
    const data = JSON.parse(raw) as Partial<SaveData>;
    // version 在 SaveData 里字面量是 2，拿 unknown 兜一层再比，避免 TS 把“!== 1”判成无意义比较
    const version = (data as { version?: unknown }).version;
    if (version !== 1 && version !== 2) return defaultSave();
    if (typeof data.unlockedLevel !== "number") return defaultSave();
    const base = { ...defaultSave(), ...data };
    return {
      ...base,
      version: 2,
      completedLevels: Array.isArray(data.completedLevels) ? data.completedLevels : [],
      stars: data.stars && typeof data.stars === "object" ? data.stars : {},
      bestScores: data.bestScores && typeof data.bestScores === "object" ? data.bestScores : {},
      inProgress: isValidSnapshot(data.inProgress) ? data.inProgress : null,
      settings: {
        soundEnabled: data.settings?.soundEnabled !== false,
        timedChallenge: data.settings?.timedChallenge === true,
      },
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

/** 通关后更新存档：记录星级（保留最好成绩）与最高分，并解锁下一关、清除本关中断点 */
export function recordCompletion(
  save: SaveData,
  levelId: string,
  levelNumber: number,
  stars: number,
  score = 0,
): SaveData {
  return {
    ...save,
    unlockedLevel: Math.max(save.unlockedLevel, levelNumber + 1),
    completedLevels: save.completedLevels.includes(levelId)
      ? save.completedLevels
      : [...save.completedLevels, levelId],
    stars: { ...save.stars, [levelId]: Math.max(save.stars[levelId] ?? 0, stars) },
    bestScores: { ...save.bestScores, [levelId]: Math.max(save.bestScores[levelId] ?? 0, score) },
    inProgress: save.inProgress?.levelId === levelId ? null : save.inProgress,
  };
}

/** 保存中断点快照（切后台/退出时调用） */
export function saveProgress(save: SaveData, snapshot: LevelSnapshot): SaveData {
  return { ...save, inProgress: snapshot };
}

/** 清除中断点（重新开始时调用） */
export function clearProgress(save: SaveData): SaveData {
  return { ...save, inProgress: null };
}

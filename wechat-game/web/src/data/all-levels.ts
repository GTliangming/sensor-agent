import type { LevelConfig } from "../core/types";
import type { ConfigBundle } from "../core/validator";
import { CHAPTER, ITEMS, MASKS, SCENES } from "./index";

// 一次性加载全部关卡，只给测试、校验脚本和 e2e 用；游戏运行时用 ./index 的 loadLevel 按需加载。

const levelModules = import.meta.glob<LevelConfig>("./levels/level_*.json", { eager: true, import: "default" });

export const LEVELS: LevelConfig[] = Object.keys(levelModules)
  .sort()
  .map((k) => levelModules[k]);

export const CONFIG_BUNDLE: ConfigBundle = { items: ITEMS, scenes: SCENES, chapter: CHAPTER, levels: LEVELS, masks: MASKS };

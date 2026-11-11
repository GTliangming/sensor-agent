import itemsFile from "./items_ch01.json";
import scenesFile from "./scenes_ch01.json";
import chapterFile from "./chapter_01.json";
import type { ChapterConfig, ItemConfig, ItemsFile, LevelConfig, SceneConfig, ScenesFile } from "../core/types";
import type { ConfigBundle } from "../core/validator";

// 关卡 JSON 由 scripts/generate-levels.ts 生成，按文件名排序加载
const levelModules = import.meta.glob<LevelConfig>("./levels/level_*.json", {
  eager: true,
  import: "default",
});

export const ITEMS: ItemConfig[] = (itemsFile as ItemsFile).items;
export const SCENES: SceneConfig[] = (scenesFile as ScenesFile).scenes;
export const CHAPTER: ChapterConfig = chapterFile as ChapterConfig;
export const LEVELS: LevelConfig[] = Object.keys(levelModules)
  .sort()
  .map((k) => levelModules[k]);

export const ITEM_MAP = new Map(ITEMS.map((i) => [i.id, i]));
export const SCENE_MAP = new Map(SCENES.map((s) => [s.id, s]));

export const CONFIG_BUNDLE: ConfigBundle = { items: ITEMS, scenes: SCENES, chapter: CHAPTER, levels: LEVELS };

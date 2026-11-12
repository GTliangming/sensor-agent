import itemsFile from "./items_ch01.json";
import scenesFile from "./scenes_ch01.json";
import chapterFile from "./chapter_01.json";
import masksFile from "./item_masks.json";
import { MaskLibrary, type ItemMasksFile } from "../core/mask";
import type { ChapterConfig, ItemConfig, ItemsFile, LevelConfig, SceneConfig, ScenesFile } from "../core/types";

// 游戏运行时用的配置。关卡 JSON 按需加载（进关时才下载），选关界面只用章节里的关卡摘要。
// 需要一次拿到全部关卡的脚本和测试请用 ./all-levels。

export const ITEMS: ItemConfig[] = (itemsFile as ItemsFile).items;
export const SCENES: SceneConfig[] = (scenesFile as ScenesFile).scenes;
export const CHAPTER: ChapterConfig = chapterFile as ChapterConfig;

export const ITEM_MAP = new Map(ITEMS.map((i) => [i.id, i]));
export const SCENE_MAP = new Map(SCENES.map((s) => [s.id, s]));

/** 图标形状掩码，由 scripts/export-icons.ts 生成；点击判定和遮挡校验都用它 */
export const MASKS = new MaskLibrary(masksFile as ItemMasksFile);

const levelLoaders = import.meta.glob<LevelConfig>("./levels/level_*.json", { import: "default" });

export async function loadLevel(id: string): Promise<LevelConfig> {
  const loader = levelLoaders[`./levels/${id}.json`];
  if (!loader) throw new Error(`关卡 ${id} 不存在`);
  return loader();
}

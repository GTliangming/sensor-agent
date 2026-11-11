import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import itemsFile from "../src/data/items_ch01.json";
import type { ChapterConfig, ItemsFile, ScenesFile } from "../src/core/types";
import { validateBundle } from "../src/core/validator";
import { generateLevel } from "./level-generator";
import { LEVEL_SPECS } from "./level-specs";
import { SCENES } from "./scene-specs";

// 生成第一章场景、章节和 10 个关卡 JSON。种子固定，重复运行结果一致。
// 用法：npm run gen:levels

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "../src/data");
const items = (itemsFile as ItemsFile).items;
const itemMap = new Map(items.map((i) => [i.id, i]));
const sceneMap = new Map(SCENES.map((s) => [s.id, s]));

const write = (relPath: string, data: unknown) => {
  const path = join(dataDir, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

const levels = LEVEL_SPECS.map((spec) => {
  const scene = sceneMap.get(spec.sceneId);
  if (!scene) throw new Error(`场景 ${spec.sceneId} 未定义`);
  const { level, seed } = generateLevel(spec, itemMap, scene, spec.number * 1000);
  console.log(`${level.id} ${level.name}: ${level.itemInstances.length} 个物件, 种子 ${seed}`);
  return level;
});

const chapter: ChapterConfig = {
  id: "chapter_01",
  chapterNumber: 1,
  name: "出租屋的凌晨",
  description: "凌晨的出租屋里，东西总是找不到。",
  levelIds: levels.map((l) => l.id),
};

const report = validateBundle({ items, scenes: SCENES, chapter, levels });
if (report.errors.length > 0) {
  console.error(report.errors.join("\n"));
  process.exit(1);
}

write("scenes_ch01.json", { chapterId: "chapter_01", scenes: SCENES } satisfies ScenesFile);
write("chapter_01.json", chapter);
for (const level of levels) write(`levels/${level.id}.json`, level);
console.log("已写入 src/data，校验通过");

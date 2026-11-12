// 遮挡阈值实验：MIN_OVERLAP_POINTS 用 3 / 5 / 8 三档重跑生成，对比被压住的实例数，
// 并统计“擦边”实例——只被盖住 3–4 个掩码点（48×48 共 2304 点），玩家肉眼几乎看不出压住了却点不了。
// 用法：npx vite-node scripts/occlusion-experiment.ts（只读内存生成，不写任何文件）

import itemsFile from "../src/data/items_ch01.json";
import masksFile from "../src/data/item_masks.json";
import type { ItemsFile } from "../src/core/types";
import { decodeMask, shapeContains, shapePoints, type ItemMasksFile } from "../src/core/mask";
import { solveLevel } from "../src/core/solver";
import { generateLevel } from "./level-generator";
import { LEVEL_SPECS } from "./level-specs";
import { SCENES } from "./scene-specs";

const items = (itemsFile as ItemsFile).items;
const itemMap = new Map(items.map((i) => [i.id, i]));
const sceneMap = new Map(SCENES.map((s) => [s.id, s]));

for (const minOverlap of [3, 5, 8]) {
  try {
    let instances = 0;
    let blocked = 0;
    let minWrongTotal = 0;
    const perLevel: string[] = [];
    for (const spec of LEVEL_SPECS) {
      const scene = sceneMap.get(spec.sceneId)!;
      const { level } = generateLevel(spec, itemMap, scene, spec.number * 1000, 20000, { minOverlapPoints: minOverlap });
      const b = level.itemInstances.filter((i) => i.blocking.length > 0).length;
      const solved = solveLevel(level);
      instances += level.itemInstances.length;
      blocked += b;
      minWrongTotal += solved.minWrong;
      perLevel.push(`${level.id}:压住${b}/minWrong${solved.minWrong}`);
    }
    console.log(
      `minOverlap=${minOverlap}: 10 关共 ${instances} 实例，被压住 ${blocked} 个，minWrong 合计 ${minWrongTotal} ` +
        `(各关 ${perLevel.join(" ")})`,
    );
  } catch (e) {
    // 阈值太松时生成器可能在 20000 次内找不到满足规格的布局，这本身就是实验结论
    console.log(`minOverlap=${minOverlap}: 生成失败——${e instanceof Error ? e.message : e}`);
  }
}

// 擦边统计：在阈值 3 生成的关卡上，算每个实例被盖住的最大掩码点数
{
  const buckets = { "3-4点(阈值5会放开)": 0, "5-7点(阈值8会放开)": 0, "8点以上": 0 };
  for (const spec of LEVEL_SPECS) {
    const scene = sceneMap.get(spec.sceneId)!;
    const { level } = generateLevel(spec, itemMap, scene, spec.number * 1000, 20000, { minOverlapPoints: 3 });
    const shapes = new Map(
      level.itemInstances.map((i) => [
        i.id,
        {
          x: i.position.x,
          y: i.position.y,
          rotation: i.rotation,
          tile: itemMap.get(i.itemId)!.size.width * i.scale,
          mask: decodeMask((masksFile as ItemMasksFile).masks[i.itemId], (masksFile as ItemMasksFile).size),
        },
      ]),
    );
    for (const inst of level.itemInstances) {
      const points = shapePoints(shapes.get(inst.id)!, (masksFile as ItemMasksFile).size);
      let maxCovered = 0;
      for (const other of level.itemInstances.filter((o) => o.layer > inst.layer)) {
        const covered = points.filter((p) =>
          shapeContains(shapes.get(other.id)!, p.x, p.y, (masksFile as ItemMasksFile).size),
        ).length;
        maxCovered = Math.max(maxCovered, covered);
      }
      if (maxCovered >= 3 && maxCovered <= 4) buckets["3-4点(阈值5会放开)"]++;
      else if (maxCovered >= 5 && maxCovered <= 7) buckets["5-7点(阈值8会放开)"]++;
      else if (maxCovered >= 8) buckets["8点以上"]++;
    }
  }
  console.log("阈值 3 生成的关卡里，被压住实例按最大覆盖点数分布：", buckets);
  console.log(
    "结论（2026-11-12 实测）：阈值 3 与 5 生成的 10 关几乎一致（被压住 222 vs 224 个，minWrong 合计同为 16），" +
      "且阈值 3 的关卡里 0 个实例只被盖住 3–4 点（221 个在 8 点以上）——粗排几何已保证压住就是实打实压住，" +
      "所谓“擦边点不了”在生成数据里基本不存在；阈值 8 则第 3 关在 20000 次内生成失败，不可用。默认取 5，" +
      "只为留出安全余量，不改变实际玩法。",
  );
}

import type { Rect } from "../src/core/types";
import type { Rng } from "../src/core/rng";
import { SCENE_RECT } from "../src/layout";

// 物件堆的几何布局：整块物品区按网格铺满，逐层错位叠放。
// 最上层是 cols × rows 的满铺网格；往下一层错开半格；再往下一层错开四分之一格。
// 遮挡关系由几何重叠推导（blocking = 谁挡住我），画面与逻辑一致。

export interface PileCell {
  index: number;
  layer: number;
  x: number;
  y: number;
  rotation: number;
  /** 直接挡住该格的上层格下标 */
  blockers: number[];
}

export interface PileShape {
  layers: number;
  cols: number;
  rows: number;
  tile: number;
}

const BLOCK_THRESHOLD = 0.08; // 被上层覆盖面积占比超过该值即视为被遮挡
const MIN_VISIBLE = 0.2; // 下层物件至少露出的面积比例，太少的直接不放
const JITTER = 0.1; // 位置抖动（相对格宽）
// 物件只画图标、没有底板。粗排时把图标近似成边长 76% 的方块（略大于多数图标的实际轮廓，
// 保证真实遮挡基本是粗排遮挡的子集），身份确定后再按真实轮廓精确重算遮挡
const FOOTPRINT = 0.76;

function rectAt(x: number, y: number, tile: number): Rect {
  const s = tile * FOOTPRINT;
  return { x: x - s / 2, y: y - s / 2, width: s, height: s };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function visibleFraction(r: Rect, covers: Rect[]): number {
  const n = 10;
  let visible = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const px = r.x + ((i + 0.5) / n) * r.width;
      const py = r.y + ((j + 0.5) / n) * r.height;
      const covered = covers.some((c) => px >= c.x && px <= c.x + c.width && py >= c.y && py <= c.y + c.height);
      if (!covered) visible++;
    }
  }
  return visible / (n * n);
}

/** 第 k 层（从上往下数）的网格：列数、行数、偏移（以格为单位） */
function gridFor(k: number, cols: number, rows: number) {
  if (k === 0) return { cols, rows, ox: 0, oy: 0 }; // 最上层：格心
  if (k === 1) return { cols: cols - 1, rows: rows - 1, ox: 0.5, oy: 0.5 }; // 格角，从缝隙露出
  return { cols: cols - 1, rows, ox: 0.5, oy: 0 }; // 左右两格之间
}

export function buildPile(shape: PileShape, rng: Rng): PileCell[] {
  const { layers, cols, rows, tile } = shape;
  const cellW = SCENE_RECT.width / cols;
  const cellH = SCENE_RECT.height / rows;
  const half = (tile * FOOTPRINT) / 2;
  const clampX = (x: number) => Math.min(Math.max(x, SCENE_RECT.x + half), SCENE_RECT.x + SCENE_RECT.width - half);
  const clampY = (y: number) => Math.min(Math.max(y, SCENE_RECT.y + half), SCENE_RECT.y + SCENE_RECT.height - half);

  const cells: PileCell[] = [];
  // 从最上层开始摆，下层要根据已摆好的上层计算露出面积
  for (let k = 0; k < layers; k++) {
    const layer = layers - 1 - k;
    const g = gridFor(k, cols, rows);
    const above = cells.map((c) => rectAt(c.x, c.y, tile));
    for (let i = 0; i < g.cols; i++) {
      for (let j = 0; j < g.rows; j++) {
        const x = clampX(SCENE_RECT.x + (i + 0.5 + g.ox) * cellW + rng.range(-JITTER, JITTER) * cellW);
        const y = clampY(SCENE_RECT.y + (j + 0.5 + g.oy) * cellH + rng.range(-JITTER, JITTER) * cellH);
        const r = rectAt(x, y, tile);
        if (k > 0 && visibleFraction(r, above) < MIN_VISIBLE) continue;
        const blockers = cells
          .filter((c) => c.layer > layer && overlapArea(r, rectAt(c.x, c.y, tile)) / (r.width * r.height) > BLOCK_THRESHOLD)
          .map((c) => c.index);
        if (k > 0 && blockers.length === 0) continue;
        cells.push({ index: cells.length, layer, x, y, rotation: Math.round(rng.range(-12, 12)), blockers });
      }
    }
  }
  return cells;
}

/** 某格的全部传递遮挡者 */
export function ancestorsOf(cell: PileCell, cells: PileCell[]): Set<number> {
  const result = new Set<number>();
  const queue = [...cell.blockers];
  while (queue.length > 0) {
    const i = queue.pop()!;
    if (result.has(i)) continue;
    result.add(i);
    queue.push(...cells[i].blockers);
  }
  return result;
}

// 物件形状掩码：N×N 位图，1 表示图标本体（不透明），行从上到下。
// 关卡生成、配置校验、运行时点击判定都用同一份掩码，保证“看起来压住”“点不动”“校验通过”三者一致。

import type { ItemInstance } from "./types";
import { OCCLUSION_TUNING } from "./tuning";

export const MASK_SIZE = 48;

/**
 * 占位图标（emoji）的绘制参数。scripts/export-icons.ts 按它把图标烘焙成 PNG 并导出轮廓，
 * 改了要重新运行 npm run export:icons 和 npm run gen:levels。
 */
export const ICON_DRAW = {
  fontScale: 0.84,
  centerY: 0.52,
  fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif',
  alphaThreshold: 140,
};

/** 物件贴图边长（像素） */
export const SPRITE_PX = 256;

/** 物件贴图文件名，位于 public/sprites/（WebP，带透明通道） */
export function spriteFileName(itemId: string, variantId: string): string {
  return `${itemId}__${variantId}.webp`;
}

/** 上层图标至少盖住下层图标这么多个掩码采样点，才算遮挡。集中配置见 tuning.ts，默认 5。 */
export const MIN_OVERLAP_POINTS = OCCLUSION_TUNING.minOverlapPoints;

export interface ItemMasksFile {
  size: number;
  /** itemId → base64 位图 */
  masks: Record<string, string>;
}

export function encodeMask(bits: Uint8Array): string {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((b, i) => {
    if (b) bytes[i >> 3] |= 1 << (i & 7);
  });
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

export function decodeMask(encoded: string, size: number): Uint8Array {
  const raw = atob(encoded);
  const bits = new Uint8Array(size * size);
  for (let i = 0; i < bits.length; i++) bits[i] = (raw.charCodeAt(i >> 3) >> (i & 7)) & 1;
  return bits;
}

export interface PlacedShape {
  x: number;
  y: number;
  /** 角度，逆时针（与 Three.js rotation.z 一致） */
  rotation: number;
  /** 贴图边长（设计像素） */
  tile: number;
  mask: Uint8Array;
}

/** 形状本体的采样点（世界坐标，Y 轴向上） */
export function shapePoints(s: PlacedShape, size = MASK_SIZE): { x: number; y: number }[] {
  const rad = (s.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const points: { x: number; y: number }[] = [];
  for (let my = 0; my < size; my++) {
    for (let mx = 0; mx < size; mx++) {
      if (!s.mask[my * size + mx]) continue;
      const lx = ((mx + 0.5) / size - 0.5) * s.tile;
      const ly = (0.5 - (my + 0.5) / size) * s.tile;
      points.push({ x: s.x + lx * cos - ly * sin, y: s.y + lx * sin + ly * cos });
    }
  }
  return points;
}

/** 世界坐标点是否落在形状本体上 */
export function shapeContains(s: PlacedShape, px: number, py: number, size = MASK_SIZE): boolean {
  const rad = (-s.rotation * Math.PI) / 180;
  const dx = px - s.x;
  const dy = py - s.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const mx = Math.floor((lx / s.tile + 0.5) * size);
  const my = Math.floor((0.5 - ly / s.tile) * size);
  if (mx < 0 || my < 0 || mx >= size || my >= size) return false;
  return s.mask[my * size + mx] === 1;
}

/** 掩码在 uv（0..1，v 向上）处是否为图标本体，dilate 为外扩格数（点击容差） */
export function maskHitAt(mask: Uint8Array, u: number, v: number, dilate = 0, size = MASK_SIZE): boolean {
  const cx = Math.floor(u * size);
  const cy = Math.floor((1 - v) * size);
  for (let dy = -dilate; dy <= dilate; dy++) {
    for (let dx = -dilate; dx <= dilate; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && y >= 0 && x < size && y < size && mask[y * size + x]) return true;
    }
  }
  return false;
}

/** 解码后的掩码缓存 */
export class MaskLibrary {
  private cache = new Map<string, Uint8Array>();
  constructor(private file: ItemMasksFile) {}

  get size(): number {
    return this.file.size;
  }

  get(itemId: string): Uint8Array | undefined {
    const hit = this.cache.get(itemId);
    if (hit) return hit;
    const encoded = this.file.masks[itemId];
    if (!encoded) return undefined;
    const mask = decodeMask(encoded, this.file.size);
    this.cache.set(itemId, mask);
    return mask;
  }
}

/**
 * 按真实轮廓计算每个实例的 blocking（谁挡住我）：层级更高、且图标本体实际盖住了本实例的才算。
 * tileOf 返回实例的贴图边长（设计像素）。缺掩码的物件会抛错。
 * minOverlapPoints 可覆盖集中配置（遮挡实验用），默认读 tuning.ts。
 */
export function computeShapeBlocking(
  instances: ItemInstance[],
  tileOf: (inst: ItemInstance) => number,
  masks: MaskLibrary,
  minOverlapPoints: number = OCCLUSION_TUNING.minOverlapPoints,
): Map<string, string[]> {
  const shapes = instances.map((inst) => {
    const mask = masks.get(inst.itemId);
    if (!mask) throw new Error(`物件 ${inst.itemId} 缺少形状掩码，先运行 npm run export:icons`);
    return { x: inst.position.x, y: inst.position.y, rotation: inst.rotation, tile: tileOf(inst), mask };
  });
  const points = shapes.map((s) => shapePoints(s, masks.size));
  const result = new Map<string, string[]>();
  instances.forEach((inst, i) => {
    const blockers: string[] = [];
    instances.forEach((other, j) => {
      if (other.layer <= inst.layer) return;
      const reach = (shapes[i].tile + shapes[j].tile) / 2;
      if (Math.abs(other.position.x - inst.position.x) > reach || Math.abs(other.position.y - inst.position.y) > reach) return;
      let covered = 0;
      for (const p of points[i]) {
        if (shapeContains(shapes[j], p.x, p.y, masks.size) && ++covered >= minOverlapPoints) {
          blockers.push(other.id);
          return;
        }
      }
    });
    result.set(inst.id, blockers.sort());
  });
  return result;
}

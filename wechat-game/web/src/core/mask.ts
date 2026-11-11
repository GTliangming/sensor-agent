// 物件形状掩码：N×N 位图，1 表示图标本体（不透明），行从上到下。
// 关卡生成用它按真实形状计算遮挡，保证“看起来压住”与“点不动”一致。

export const MASK_SIZE = 48;

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

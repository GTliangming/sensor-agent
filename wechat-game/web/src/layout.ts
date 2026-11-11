// 设计分辨率与 HUD 布局（设计像素，原点左下角，Y 轴向上）。
// Three.js 正交相机与 React HUD 共用这组常量，保证飞行动画终点与格子对齐。

export const DESIGN_WIDTH = 1080;
export const DESIGN_HEIGHT = 1920;

/** 房间场景可摆放物件的区域 */
export const SCENE_RECT = { x: 30, y: 410, width: 1020, height: 1105 };

export const HEADER_HEIGHT = 150;

/** 顶部找寻格行 */
export const TARGET_ROW = { centerY: 1640, slotSize: 190, gap: 30 };

/** 底部归位格行 */
export const STORAGE_ROW = { centerY: 250, slotSize: 150, gap: 22 };

function rowCenters(count: number, slotSize: number, gap: number): number[] {
  const total = count * slotSize + (count - 1) * gap;
  const start = (DESIGN_WIDTH - total) / 2 + slotSize / 2;
  return Array.from({ length: count }, (_, i) => start + i * (slotSize + gap));
}

export function targetSlotCenter(index: number, count: number) {
  const xs = rowCenters(count, TARGET_ROW.slotSize, TARGET_ROW.gap);
  return { x: xs[index], y: TARGET_ROW.centerY };
}

export function storageSlotCenter(index: number, count: number) {
  const xs = rowCenters(count, STORAGE_ROW.slotSize, STORAGE_ROW.gap);
  return { x: xs[index], y: STORAGE_ROW.centerY };
}

/** 设计坐标 → HUD 的 CSS 百分比（top 从上往下） */
export function toCssPercent(x: number, y: number) {
  return {
    left: `${(x / DESIGN_WIDTH) * 100}%`,
    top: `${((DESIGN_HEIGHT - y) / DESIGN_HEIGHT) * 100}%`,
  };
}

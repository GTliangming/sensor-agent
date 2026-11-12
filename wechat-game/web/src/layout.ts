// 设计分辨率与 HUD 布局（设计像素，原点左下角，Y 轴向上）。
// Three.js 正交相机与 React HUD 共用同一份 StageLayout，保证飞行动画终点与格子对齐。
//
// 宽度固定 1080；高度随屏幕比例变化（1920～2400），适配全面屏，不留上下黑边。
// 关卡按主流全面屏（1080×2340，约 19.5:9）的物品区生成（SCENE_RECT）；屏幕更矮时
// 把整个物品堆等比缩小放进可用区域，等比缩放不改变任何遮挡关系。

export const DESIGN_WIDTH = 1080;
export const BASE_HEIGHT = 1920;
export const MAX_HEIGHT = 2400;
/** 生成关卡时参照的屏幕高度 */
export const REFERENCE_HEIGHT = 2340;

/** 参照屏幕下的物品区（关卡 JSON 里的坐标都在这个区域内），等于 computeLayout(2340) 的可用区域 */
export const SCENE_RECT = { x: 30, y: 450, width: 1020, height: 1435 };

export const HEADER_HEIGHT = 150;
const TARGET_TOP = 185; // 找寻格上沿距离安全区顶部
const STORAGE_BOTTOM = 175; // 归位格下沿距离安全区底部
const BOARD_PAD = 18;

export interface SlotRow {
  centerY: number;
  slotSize: number;
  gap: number;
}

export interface StageLayout {
  /** 设计高度 */
  height: number;
  safeTop: number;
  safeBottom: number;
  target: SlotRow;
  storage: SlotRow;
  /** 归位格上方标签的中心 Y */
  storageLabelY: number;
  /** 物品区底板（世界坐标） */
  board: { x: number; y: number; width: number; height: number };
  /** 关卡坐标 → 世界坐标：world = offset + local × scale */
  pile: { scale: number; offsetX: number; offsetY: number };
}

/**
 * 根据设计高度和安全区（设计像素）计算布局。多出来的高度一部分用来放大格子，其余留给物品区。
 * 物品堆等比缩放到正好放进可用区域（最大 1 倍），并居中。
 */
export function computeLayout(height = REFERENCE_HEIGHT, safeTop = 0, safeBottom = 0): StageLayout {
  const extra = Math.max(0, height - BASE_HEIGHT - safeTop - safeBottom);
  const targetSize = 190 + Math.min(50, extra * 0.12);
  const storageSize = 150 + Math.min(40, extra * 0.1);

  const targetTopY = height - safeTop - TARGET_TOP;
  const target = { centerY: targetTopY - targetSize / 2, slotSize: targetSize, gap: 30 };
  const storageBottomY = safeBottom + STORAGE_BOTTOM;
  const storage = { centerY: storageBottomY + storageSize / 2, slotSize: storageSize, gap: 22 };
  const storageTopY = storageBottomY + storageSize;

  const pileTop = targetTopY - targetSize - 30;
  const pileBottom = storageTopY + 85;
  const scale = Math.min(1, (pileTop - pileBottom) / SCENE_RECT.height);
  const sceneCx = SCENE_RECT.x + SCENE_RECT.width / 2;
  const sceneCy = SCENE_RECT.y + SCENE_RECT.height / 2;
  const pile = {
    scale,
    offsetX: DESIGN_WIDTH / 2 - sceneCx * scale,
    offsetY: (pileTop + pileBottom) / 2 - sceneCy * scale,
  };

  return {
    height,
    safeTop,
    safeBottom,
    target,
    storage,
    storageLabelY: storageTopY + 40,
    board: {
      x: SCENE_RECT.x - BOARD_PAD,
      y: pileBottom - BOARD_PAD,
      width: SCENE_RECT.width + BOARD_PAD * 2,
      height: pileTop - pileBottom + BOARD_PAD * 2,
    },
    pile,
  };
}

function rowCenters(count: number, slotSize: number, gap: number): number[] {
  const total = count * slotSize + (count - 1) * gap;
  const start = (DESIGN_WIDTH - total) / 2 + slotSize / 2;
  return Array.from({ length: count }, (_, i) => start + i * (slotSize + gap));
}

export function slotCenter(row: SlotRow, index: number, count: number) {
  return { x: rowCenters(count, row.slotSize, row.gap)[index], y: row.centerY };
}

/** 设计坐标 → HUD 的 CSS 百分比（top 从上往下） */
export function toCssPercent(layout: StageLayout, x: number, y: number) {
  return {
    left: `${(x / DESIGN_WIDTH) * 100}%`,
    top: `${((layout.height - y) / layout.height) * 100}%`,
  };
}

/** 设计像素 → CSS 长度（按舞台宽度缩放） */
export function cqw(designPx: number): string {
  return `${(designPx / DESIGN_WIDTH) * 100}cqw`;
}

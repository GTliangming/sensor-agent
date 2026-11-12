import type { SceneConfig } from "../src/core/types";
import { DESIGN_WIDTH, REFERENCE_HEIGHT, SCENE_RECT } from "../src/layout";

// 第一章 10 个场景。物品区是一整块，所有物件堆在同一个区域里逐层叠放。
// background 为舞台底色，surfaceColor 为物品区（桌面/床面/沙发面等）的占位底色，
// 正式美术到位后替换为场景底板图。

function scene(id: string, name: string, surfaceColor: string, background = "#efe8dc"): SceneConfig {
  return {
    id,
    name,
    background,
    surfaceColor,
    designResolution: { width: DESIGN_WIDTH, height: REFERENCE_HEIGHT },
    zones: [{ id: "pile", name: "物品区", bounds: { ...SCENE_RECT } }],
  };
}

export const SCENES: SceneConfig[] = [
  scene("ch01_bedside", "床头柜", "#c9a47e"),
  scene("ch01_parcels", "快递堆成山", "#cdb08a"),
  scene("ch01_milk_tea", "奶茶杯的归宿", "#c4a07a"),
  scene("ch01_drawer", "抽屉里的耳机", "#b38a63"),
  scene("ch01_desk", "桌面大扫除", "#c9a47e"),
  scene("ch01_takeaway", "外卖盒之灾", "#b9a28a"),
  scene("ch01_wardrobe", "衣柜里的旧T恤", "#a9b7c6"),
  scene("ch01_phone_case", "手机壳博物馆", "#c4a07a"),
  scene("ch01_cables", "数据线打结了", "#a9b2a6"),
  scene("ch01_sofa", "沙发缝里的硬币", "#9fb3a6"),
];

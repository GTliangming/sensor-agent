import type { FurnitureKind, SceneConfig } from "../src/core/types";
import { DESIGN_WIDTH, REFERENCE_HEIGHT, SCENE_RECT } from "../src/layout";

// 第一章 10 个场景。物品区是一整块，所有物件堆在同一个区域里逐层叠放。
// background 为舞台底色，surfaceColor 为物品区（桌面/床面/沙发面等）的占位底色，
// 正式美术到位后替换为场景底板图。
// room 是房间感底衬（墙面带 + 地板带 + 家具剪影，低饱和扁平色块）：10 关靠墙面/地板配色和
// 家具剪影区分，不再是同一个物品堆只换底色；正式美术到位后整段替换为场景底板图。

function scene(
  id: string,
  name: string,
  surfaceColor: string,
  room: { wall: string; floor: string; furniture: FurnitureKind },
  background = "#efe8dc",
): SceneConfig {
  return {
    id,
    name,
    background,
    surfaceColor,
    designResolution: { width: DESIGN_WIDTH, height: REFERENCE_HEIGHT },
    zones: [{ id: "pile", name: "物品区", bounds: { ...SCENE_RECT } }],
    room,
  };
}

export const SCENES: SceneConfig[] = [
  scene("ch01_bedside", "床头柜", "#c9a47e", { wall: "#e6ddd0", floor: "#cbb493", furniture: "bed" }),
  scene("ch01_parcels", "快递堆成山", "#cdb08a", { wall: "#e9e2d4", floor: "#d3bda0", furniture: "boxes" }),
  scene("ch01_milk_tea", "奶茶杯的归宿", "#c4a07a", { wall: "#ece1d3", floor: "#cbb090", furniture: "counter" }),
  scene("ch01_drawer", "抽屉里的耳机", "#b38a63", { wall: "#e3d8c6", floor: "#c09a76", furniture: "drawer" }),
  scene("ch01_desk", "桌面大扫除", "#c9a47e", { wall: "#e8dfd1", floor: "#cbb493", furniture: "desk" }),
  scene("ch01_takeaway", "外卖盒之灾", "#b9a28a", { wall: "#e5dcd0", floor: "#c2ab90", furniture: "table" }),
  scene("ch01_wardrobe", "衣柜里的旧T恤", "#a9b7c6", { wall: "#dde4ea", floor: "#b3bfcb", furniture: "wardrobe" }),
  scene("ch01_phone_case", "手机壳博物馆", "#c4a07a", { wall: "#ece1d3", floor: "#cbb090", furniture: "shelf" }),
  scene("ch01_cables", "数据线打结了", "#a9b2a6", { wall: "#dfe4dc", floor: "#b3bcb0", furniture: "desk" }),
  scene("ch01_sofa", "沙发缝里的硬币", "#9fb3a6", { wall: "#d8e2da", floor: "#aabdaf", furniture: "sofa" }),
];

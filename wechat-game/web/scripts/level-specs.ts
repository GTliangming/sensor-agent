// 第一章 10 关的设计参数。目标物件与数量来自《关卡设计数据库》第 7 节；
// 物件总数由物品堆形状决定（整块物品区铺满并逐层叠放），比原策划表更密。
// requiredWrong：不看广告通关至少要拿走的干扰物数量（必须小于归位格容量）。

import type { PileShape } from "./pile-geometry";

export interface LevelSpec {
  number: number;
  name: string;
  sceneId: string;
  teaching: string;
  pile: PileShape;
  targets: [itemId: string, count: number][];
  distractors: string[];
  capacity: number;
  requiredWrong: number;
  autoHintSeconds: number;
  /** 被压住的目标实例至少占比 */
  buriedTargetRatio: number;
}

// tile 是贴图尺寸，图标本体约占 78%。图标比格子略小，上层之间留出缝隙，
// 下层物件从缝隙里露出来，整块区域没有空白
const SMALL: PileShape = { layers: 2, cols: 4, rows: 5, tile: 275 };
const MEDIUM: PileShape = { layers: 2, cols: 4, rows: 6, tile: 256 };
// 第 4–5 关的过渡形状：避免物件数从第 3 关的约 40 个一下跳到约 60 个（难度不要突然陡增）
const MIDDLE: PileShape = { layers: 2, cols: 5, rows: 6, tile: 220 };
const LARGE: PileShape = { layers: 2, cols: 5, rows: 7, tile: 210 };
const DEEP: PileShape = { layers: 3, cols: 5, rows: 7, tile: 210 };

// 干扰物每关 14 种，避免同一图标在一关里重复太多次；
// buriedTargetRatio 随关卡递增，越往后目标越多被压在下面
export const LEVEL_SPECS: LevelSpec[] = [
  { number: 1, name: "床头柜", sceneId: "ch01_bedside", teaching: "点击正确物件", pile: SMALL,
    targets: [["earphone", 3], ["medicine_bottle", 3]],
    distractors: ["water_cup", "tissue", "glasses", "key", "sticky_note", "pen", "power_bank", "book", "remote_control", "sock", "hair_tie", "coin", "notebook", "battery"],
    capacity: 4, requiredWrong: 0, autoHintSeconds: 12, buriedTargetRatio: 0 },
  { number: 2, name: "快递堆成山", sceneId: "ch01_parcels", teaching: "连续拾取", pile: MEDIUM,
    targets: [["delivery_note", 4], ["tape", 4]],
    distractors: ["carton", "bubble_wrap", "plastic_bag", "newspaper", "file_bag", "key", "tissue", "sticker", "pen", "sticky_note", "takeaway_box", "water_cup", "glasses", "usb_drive"],
    capacity: 4, requiredWrong: 0, autoHintSeconds: 12, buriedTargetRatio: 0.15 },
  { number: 3, name: "奶茶杯的归宿", sceneId: "ch01_milk_tea", teaching: "拿走上层，下层才能点", pile: MEDIUM,
    targets: [["milk_tea_cup", 4], ["straw", 3]],
    distractors: ["tissue", "water_cup", "plastic_bag", "sauce_packet", "sticky_note", "newspaper", "pen", "takeaway_box", "chopsticks", "key", "glasses", "coin", "book", "carton"],
    capacity: 4, requiredWrong: 0, autoHintSeconds: 12, buriedTargetRatio: 0.3 },
  { number: 4, name: "抽屉里的耳机", sceneId: "ch01_drawer", teaching: "点错会进入归位格", pile: MIDDLE,
    targets: [["earphone", 4], ["charging_cable", 3]],
    distractors: ["usb_drive", "battery", "sticky_note", "pen", "power_bank", "key", "mouse", "glasses", "charging_head", "coin", "file_bag", "notebook", "hair_tie", "remote_control"],
    capacity: 4, requiredWrong: 1, autoHintSeconds: 12, buriedTargetRatio: 0.35 },
  { number: 5, name: "桌面大扫除", sceneId: "ch01_desk", teaching: "注意归位格容量", pile: MIDDLE,
    targets: [["book", 4], ["notebook", 4]],
    distractors: ["pen", "sticky_note", "file_bag", "glasses", "water_cup", "mouse", "newspaper", "usb_drive", "earphone", "charging_cable", "tissue", "medicine_bottle", "milk_tea_cup", "key"],
    capacity: 4, requiredWrong: 2, autoHintSeconds: 12, buriedTargetRatio: 0.35 },
  { number: 6, name: "外卖盒之灾", sceneId: "ch01_takeaway", teaching: "找不到时会自动提示", pile: LARGE,
    targets: [["takeaway_box", 4], ["chopsticks", 4]],
    distractors: ["plastic_bag", "sauce_packet", "tissue", "water_cup", "newspaper", "carton", "milk_tea_cup", "straw", "delivery_note", "remote_control", "coin", "key", "medicine_bottle", "glasses"],
    capacity: 4, requiredWrong: 1, autoHintSeconds: 8, buriedTargetRatio: 0.4 },
  { number: 7, name: "衣柜里的旧T恤", sceneId: "ch01_wardrobe", teaching: "三个目标一起找", pile: DEEP,
    targets: [["tshirt", 4], ["long_pants", 3], ["short_pants", 3]],
    distractors: ["hanger", "sock", "pajamas", "cushion", "plastic_bag", "hair_tie", "glasses", "key", "coin", "tissue", "carton", "file_bag", "earphone", "sticker"],
    capacity: 4, requiredWrong: 1, autoHintSeconds: 12, buriedTargetRatio: 0.4 },
  { number: 8, name: "手机壳博物馆", sceneId: "ch01_phone_case", teaching: "归位格满了可以救场", pile: DEEP,
    targets: [["mobile_case", 5], ["mobile_screen_protector", 3]],
    distractors: ["charging_head", "power_bank", "sticker", "usb_drive", "battery", "earphone", "plastic_bag", "charging_cable", "mouse", "glasses", "key", "remote_control", "sticky_note", "coin"],
    capacity: 4, requiredWrong: 3, autoHintSeconds: 12, buriedTargetRatio: 0.45 },
  { number: 9, name: "数据线打结了", sceneId: "ch01_cables", teaching: "层层压住的复杂遮挡", pile: DEEP,
    targets: [["charging_cable", 4], ["charging_head", 3]],
    distractors: ["power_bank", "mouse", "usb_drive", "battery", "earphone", "tissue", "glasses", "mobile_case", "hair_tie", "remote_control", "key", "pen", "mobile_screen_protector", "sticker"],
    capacity: 4, requiredWrong: 2, autoHintSeconds: 12, buriedTargetRatio: 0.4 },
  { number: 10, name: "沙发缝里的硬币", sceneId: "ch01_sofa", teaching: "综合验收", pile: DEEP,
    targets: [["coin", 5], ["remote_control", 2], ["hair_tie", 3]],
    distractors: ["cushion", "sock", "tissue", "key", "glasses", "pajamas", "plastic_bag", "sticker", "earphone", "milk_tea_cup", "chopsticks", "book", "mobile_case", "pen"],
    capacity: 4, requiredWrong: 3, autoHintSeconds: 12, buriedTargetRatio: 0.5 },
];

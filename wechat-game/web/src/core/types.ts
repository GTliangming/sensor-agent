// 配置类型以《数据结构设计文档》v1.0 为准。
// 遮挡语义：ItemInstance.blocking = 遮挡“当前物件”的实例 ID 列表（谁挡住我）。

export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ItemVariant {
  id: string;
  displayName: string;
  /** 占位图底色，正式美术资源接入后改为 image 路径 */
  color: string;
}

export interface ItemConfig {
  id: string;
  name: string;
  category: string;
  /** 占位图图标（emoji），正式美术资源接入后移除 */
  icon: string;
  size: { width: number; height: number };
  variants: ItemVariant[];
  defaultVariantId: string;
}

export interface ItemsFile {
  chapterId: string;
  items: ItemConfig[];
}

export interface SceneZone {
  id: string;
  name: string;
  bounds: Rect;
}

/** 房间感底衬：墙面带 + 地板带 + 家具剪影（低饱和扁平色块，程序化绘制，无外部图片）。
 * 正式美术到位后替换为场景底板图。 */
export type FurnitureKind =
  | "bed"
  | "boxes"
  | "counter"
  | "drawer"
  | "desk"
  | "wardrobe"
  | "shelf"
  | "sofa"
  | "table";

export interface RoomBackdrop {
  wall: string;
  floor: string;
  furniture: FurnitureKind;
}

export interface SceneConfig {
  id: string;
  name: string;
  background: string;
  /** 物品区占位底色，正式美术资源接入后改为场景底板图 */
  surfaceColor: string;
  designResolution: { width: number; height: number };
  zones: SceneZone[];
  room: RoomBackdrop;
}

export interface ScenesFile {
  chapterId: string;
  scenes: SceneConfig[];
}

export interface ChapterConfig {
  id: string;
  chapterNumber: number;
  name: string;
  description: string;
  levelIds: string[];
  /** 选关界面用的关卡摘要，关卡 JSON 按需加载，选关时不需要整关数据 */
  levels: { id: string; levelNumber: number; name: string }[];
}

export interface Objective {
  itemId: string;
  requiredCount: number;
  displayVariant?: string;
}

export interface ItemInstance {
  id: string;
  itemId: string;
  variantId: string;
  position: Vec2;
  rotation: number;
  scale: number;
  layer: number;
  zone: string;
  blocking: string[];
}

export interface GridConfig {
  targetSlots: { baseCount: number; maxCount: number };
  collectionSlots: { capacity: number };
  adConfig: { enabled: boolean; simulated: boolean };
}

export interface HintConfig {
  enabled: boolean;
  /** 无操作多少秒后自动提示，0 表示关闭自动提示 */
  autoHintSeconds: number;
  maxFreeUses: number;
  highlightDuration: number;
}

export interface CompletionConfig {
  requireAllObjectivesCompleted: boolean;
  nextLevelId?: string;
}

export interface LevelConfig {
  id: string;
  chapterId: string;
  levelNumber: number;
  name: string;
  sceneId: string;
  difficulty: number;
  teaching: string;
  /** 必要失误：不看广告通关至少要放进归位格的干扰物数量。生成时算出，星级按超出它的失误计算 */
  requiredWrong: number;
  designResolution: { width: number; height: number };
  objectives: Objective[];
  itemInstances: ItemInstance[];
  gridConfig: GridConfig;
  hintConfig: HintConfig;
  completionConfig: CompletionConfig;
}

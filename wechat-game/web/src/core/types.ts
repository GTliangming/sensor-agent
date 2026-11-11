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

export interface SceneConfig {
  id: string;
  name: string;
  background: string;
  /** 物品区占位底色，正式美术资源接入后改为场景底板图 */
  surfaceColor: string;
  designResolution: { width: number; height: number };
  zones: SceneZone[];
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
  designResolution: { width: number; height: number };
  objectives: Objective[];
  itemInstances: ItemInstance[];
  gridConfig: GridConfig;
  hintConfig: HintConfig;
  completionConfig: CompletionConfig;
}

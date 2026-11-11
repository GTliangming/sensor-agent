import { findBlockingCycle } from "./occlusion";
import { solveLevel } from "./solver";
import type { ChapterConfig, ItemConfig, LevelConfig, SceneConfig } from "./types";

export interface ConfigBundle {
  items: ItemConfig[];
  scenes: SceneConfig[];
  chapter: ChapterConfig;
  levels: LevelConfig[];
}

export interface ValidationReport {
  errors: string[];
  warnings: string[];
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

export function validateItems(items: ItemConfig[], report: ValidationReport): void {
  for (const d of duplicates(items.map((i) => i.id))) report.errors.push(`物件 ID 重复: ${d}`);
  for (const item of items) {
    const p = `物件 ${item.id}`;
    if (!ID_PATTERN.test(item.id)) report.errors.push(`${p}: ID 必须为小写英文+下划线`);
    if (!item.name) report.errors.push(`${p}: name 为空`);
    if (!(item.size.width > 0 && item.size.height > 0)) report.errors.push(`${p}: size 必须大于 0`);
    if (item.variants.length === 0) report.errors.push(`${p}: variants 为空`);
    for (const d of duplicates(item.variants.map((v) => v.id))) {
      report.errors.push(`${p}: 变体 ID 重复 ${d}`);
    }
    if (!item.variants.some((v) => v.id === item.defaultVariantId)) {
      report.errors.push(`${p}: defaultVariantId ${item.defaultVariantId} 不存在`);
    }
  }
}

export function validateLevel(
  level: LevelConfig,
  items: Map<string, ItemConfig>,
  scenes: Map<string, SceneConfig>,
  report: ValidationReport,
): void {
  const p = `关卡 ${level.id}`;
  const err = (msg: string) => report.errors.push(`${p}: ${msg}`);
  const scene = scenes.get(level.sceneId);
  if (!scene) err(`sceneId ${level.sceneId} 不存在`);
  if (level.objectives.length === 0) err("objectives 为空");
  if (level.itemInstances.length === 0) err("itemInstances 为空");

  const instanceIds = new Set(level.itemInstances.map((i) => i.id));
  for (const d of duplicates(level.itemInstances.map((i) => i.id))) err(`实例 ID 重复 ${d}`);

  for (const inst of level.itemInstances) {
    const item = items.get(inst.itemId);
    if (!item) {
      err(`实例 ${inst.id} 引用了不存在的物件 ${inst.itemId}`);
      continue;
    }
    if (!item.variants.some((v) => v.id === inst.variantId)) {
      err(`实例 ${inst.id} 的变体 ${inst.variantId} 不属于 ${inst.itemId}`);
    }
    if (!(inst.scale > 0)) err(`实例 ${inst.id} scale 必须大于 0`);
    if (!Number.isInteger(inst.layer) || inst.layer < 0) err(`实例 ${inst.id} layer 非法`);
    for (const b of inst.blocking) {
      if (b === inst.id) err(`实例 ${inst.id} 遮挡了自己`);
      else if (!instanceIds.has(b)) err(`实例 ${inst.id} 的遮挡者 ${b} 不存在`);
    }
    if (scene) {
      if (!scene.zones.some((z) => z.id === inst.zone)) err(`实例 ${inst.id} 的区域 ${inst.zone} 不存在`);
      const { width, height } = scene.designResolution;
      const { x, y } = inst.position;
      if (x < 0 || y < 0 || x > width || y > height) err(`实例 ${inst.id} 坐标超出画布`);
    }
  }
  for (const d of duplicates(level.objectives.map((o) => o.itemId))) err(`目标物件重复 ${d}`);
  for (const o of level.objectives) {
    if (!items.has(o.itemId)) err(`目标物件 ${o.itemId} 不存在`);
    if (!(o.requiredCount >= 1)) err(`目标 ${o.itemId} 数量必须 ≥ 1`);
    const available = level.itemInstances.filter((i) => i.itemId === o.itemId).length;
    if (available < o.requiredCount) {
      err(`目标 ${o.itemId} 需要 ${o.requiredCount} 个，场景中只有 ${available} 个`);
    }
  }

  const { targetSlots, collectionSlots } = level.gridConfig;
  if (targetSlots.maxCount < targetSlots.baseCount) err("targetSlots.maxCount 小于 baseCount");
  if (level.objectives.length > targetSlots.baseCount) err("目标种类数超过找寻格数量");
  if (!(collectionSlots.capacity >= 1)) err("归位格容量必须 ≥ 1");

  const cycle = findBlockingCycle(level.itemInstances);
  if (cycle) {
    err(`遮挡关系成环: ${cycle.join(" → ")}`);
    return; // 有环时可完成性检查无意义
  }
  if (report.errors.some((e) => e.startsWith(p))) return;

  const solved = solveLevel(level);
  if (!solved.completable) err(`关卡不可完成: ${solved.reason}`);
}

export function validateBundle(bundle: ConfigBundle): ValidationReport {
  const report: ValidationReport = { errors: [], warnings: [] };
  validateItems(bundle.items, report);
  const items = new Map(bundle.items.map((i) => [i.id, i]));
  const scenes = new Map(bundle.scenes.map((s) => [s.id, s]));
  const levels = new Map(bundle.levels.map((l) => [l.id, l]));

  for (const d of duplicates(bundle.levels.map((l) => l.id))) report.errors.push(`关卡 ID 重复: ${d}`);
  for (const id of bundle.chapter.levelIds) {
    const level = levels.get(id);
    if (!level) report.errors.push(`章节引用的关卡 ${id} 不存在`);
    else if (level.chapterId !== bundle.chapter.id) {
      report.errors.push(`关卡 ${id} 的 chapterId 与章节不一致`);
    }
  }
  for (const level of bundle.levels) {
    validateLevel(level, items, scenes, report);
    const next = level.completionConfig.nextLevelId;
    if (next && !levels.has(next)) report.errors.push(`关卡 ${level.id}: nextLevelId ${next} 不存在`);
  }
  return report;
}

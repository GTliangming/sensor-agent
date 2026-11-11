import type { ItemConfig, ItemInstance, LevelConfig, SceneConfig } from "../src/core/types";
import { createRng, type Rng } from "../src/core/rng";
import { solveLevel } from "../src/core/solver";
import { decodeMask, shapeContains, shapePoints, type ItemMasksFile, type PlacedShape } from "../src/core/mask";
import masksFile from "../src/data/item_masks.json";
import type { LevelSpec } from "./level-specs";
import { ancestorsOf, buildPile, type PileCell } from "./pile-geometry";

// 关卡生成：先按物品堆形状铺满并叠放（几何决定遮挡），再给每个格子分配物件身份。
// 分配时保证：被压住的目标，其上方的全部物件要么也是目标，要么是本关的“门槛干扰物”，
// 门槛干扰物数量恰好等于 requiredWrong，因此不看广告也一定能通关。

interface Roles {
  targets: number[];
  gates: Set<number>;
}

function assignRoles(cells: PileCell[], spec: LevelSpec, rng: Rng): Roles | null {
  const targetTotal = spec.targets.reduce((sum, [, n]) => sum + n, 0);
  const ancestors = cells.map((c) => ancestorsOf(c, cells));
  const T = new Set<number>();
  const G = new Set<number>();
  const buriedNeeded = Math.ceil(spec.buriedTargetRatio * targetTotal);

  // 先埋目标：优先选上方物件少的格子
  const lower = rng
    .shuffle(cells.filter((c) => c.blockers.length > 0).map((c) => c.index))
    .sort((a, b) => ancestors[a].size - ancestors[b].size);
  let buried = 0;
  for (const c of lower) {
    if (buried >= buriedNeeded) break;
    if (T.has(c) || G.has(c)) continue;
    const fresh = rng.shuffle([...ancestors[c]].filter((i) => !T.has(i) && !G.has(i)));
    const nGates = Math.min(spec.requiredWrong - G.size, fresh.length);
    if (fresh.length - nGates > targetTotal - T.size - 1) continue;
    fresh.slice(0, nGates).forEach((i) => G.add(i));
    fresh.slice(nGates).forEach((i) => T.add(i));
    T.add(c);
    buried = [...T].filter((i) => cells[i].blockers.length > 0).length;
  }
  if (buried < buriedNeeded || G.size !== spec.requiredWrong) return null;

  // 剩余目标放在“上方物件全是目标或门槛”的格子里，优先最上层
  const free = rng.shuffle(
    cells
      .map((c) => c.index)
      .filter((i) => !T.has(i) && !G.has(i) && [...ancestors[i]].every((a) => T.has(a) || G.has(a))),
  );
  free.sort((a, b) => cells[b].layer - cells[a].layer);
  while (T.size < targetTotal && free.length > 0) T.add(free.shift()!);
  if (T.size !== targetTotal) return null;
  return { targets: rng.shuffle([...T]), gates: G };
}

function buildInstances(
  cells: PileCell[],
  roles: Roles,
  spec: LevelSpec,
  items: Map<string, ItemConfig>,
  rng: Rng,
): ItemInstance[] {
  const itemOf = new Map<number, string>();
  let cursor = 0;
  for (const [itemId, count] of spec.targets) {
    for (let k = 0; k < count; k++) itemOf.set(roles.targets[cursor++], itemId);
  }
  const pool = rng.shuffle([...spec.distractors]);
  let d = 0;
  for (const c of cells) if (!itemOf.has(c.index)) itemOf.set(c.index, pool[d++ % pool.length]);

  const counters = new Map<string, number>();
  const ids = cells.map((c) => {
    const itemId = itemOf.get(c.index)!;
    const n = (counters.get(itemId) ?? 0) + 1;
    counters.set(itemId, n);
    return `${itemId}_${String(n).padStart(3, "0")}`;
  });

  return cells.map((c) => {
    const item = items.get(itemOf.get(c.index)!);
    if (!item) throw new Error(`物件 ${itemOf.get(c.index)} 未登记`);
    return {
      id: ids[c.index],
      itemId: item.id,
      variantId: rng.pick(item.variants).id,
      position: { x: Math.round(c.x), y: Math.round(c.y) },
      rotation: c.rotation,
      // 物品堆内统一格子尺寸，scale 把物件原始尺寸换算到格子尺寸
      scale: Math.round((spec.pile.tile / item.size.width) * 1000) / 1000,
      layer: c.layer,
      zone: "pile",
      blocking: c.blockers.map((b) => ids[b]).sort(),
    };
  });
}
function toLevel(spec: LevelSpec, instances: ItemInstance[], scene: SceneConfig, items: Map<string, ItemConfig>): LevelConfig {
  const pad = (n: number) => `level_${String(n).padStart(3, "0")}`;
  return {
    id: pad(spec.number),
    chapterId: "chapter_01",
    levelNumber: spec.number,
    name: spec.name,
    sceneId: scene.id,
    difficulty: spec.number,
    teaching: spec.teaching,
    designResolution: { ...scene.designResolution },
    objectives: spec.targets.map(([itemId, requiredCount]) => ({
      itemId,
      requiredCount,
      displayVariant: items.get(itemId)!.defaultVariantId,
    })),
    itemInstances: instances,
    gridConfig: {
      targetSlots: { baseCount: spec.targets.length, maxCount: spec.targets.length },
      collectionSlots: { capacity: spec.capacity },
      adConfig: { enabled: true, simulated: true },
    },
    hintConfig: { enabled: true, autoHintSeconds: spec.autoHintSeconds, maxFreeUses: 3, highlightDuration: 2.5 },
    completionConfig: {
      requireAllObjectivesCompleted: true,
      nextLevelId: spec.number < 10 ? pad(spec.number + 1) : undefined,
    },
  };
}

function tryGenerate(spec: LevelSpec, items: Map<string, ItemConfig>, scene: SceneConfig, rng: Rng): LevelConfig | null {
  const cells = buildPile(spec.pile, rng);
  const roles = assignRoles(cells, spec, rng);
  if (!roles) return null;
  const instances = buildInstances(cells, roles, spec, items, rng);
  // 粗排用的是方块近似，身份确定后按图标真实形状重算遮挡
  applyShapeBlocking(instances, spec.pile.tile);
  const level = toLevel(spec, instances, scene, items);
  const solved = solveLevel(level);
  if (!solved.completable || solved.minWrong !== spec.requiredWrong) return null;
  const targetIds = new Set(spec.targets.map(([id]) => id));
  const targets = instances.filter((i) => targetIds.has(i.itemId));
  const buried = targets.filter((i) => i.blocking.length > 0).length / targets.length;
  if (buried < spec.buriedTargetRatio) return null;
  return level;
}

const MIN_OVERLAP_POINTS = 3; // 下层图标至少有这么多采样点被上层图标盖住才算被压住

/** 按图标形状掩码计算 blocking：上层图标本体实际盖住了下层图标本体才算遮挡 */
function applyShapeBlocking(instances: ItemInstance[], tile: number): void {
  const shapes = instances.map((inst) => {
    const encoded = MASKS.masks[inst.itemId];
    if (!encoded) throw new Error(`物件 ${inst.itemId} 缺少形状掩码，先运行 npm run export:masks`);
    const shape: PlacedShape = {
      x: inst.position.x,
      y: inst.position.y,
      rotation: inst.rotation,
      tile,
      mask: maskCache.get(inst.itemId) ?? decodeMask(encoded, MASKS.size),
    };
    maskCache.set(inst.itemId, shape.mask);
    return shape;
  });
  const points = shapes.map((s) => shapePoints(s, MASKS.size));
  instances.forEach((inst, i) => {
    inst.blocking = instances
      .filter((other, j) => {
        if (other.layer <= inst.layer) return false;
        if (Math.abs(other.position.x - inst.position.x) > tile || Math.abs(other.position.y - inst.position.y) > tile) return false;
        let covered = 0;
        for (const p of points[i]) {
          if (shapeContains(shapes[j], p.x, p.y, MASKS.size) && ++covered >= MIN_OVERLAP_POINTS) return true;
        }
        return false;
      })
      .map((o) => o.id)
      .sort();
  });
}

const MASKS = masksFile as ItemMasksFile;
const maskCache = new Map<string, Uint8Array>();

/** 从 baseSeed 开始逐个尝试种子，返回第一个满足规格的关卡及其种子 */
export function generateLevel(
  spec: LevelSpec,
  items: Map<string, ItemConfig>,
  scene: SceneConfig,
  baseSeed: number,
  maxTries = 5000,
): { level: LevelConfig; seed: number } {
  for (let i = 0; i < maxTries; i++) {
    const seed = baseSeed + i;
    const level = tryGenerate(spec, items, scene, createRng(seed));
    if (level) return { level, seed };
  }
  throw new Error(`关卡 ${spec.number} 在 ${maxTries} 次尝试内未生成满足规格的布局`);
}

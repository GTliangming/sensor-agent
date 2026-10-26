// 店铺布局(纯数据与几何,不依赖引擎)。
// 坐标系:单位米,俯视平面用 (x, z),y 轴向上;朝向 yaw=0 时面朝 -z(与 Cocos 默认前方一致)。
// 墙体由"扩建等级"推算;店内设施(货架、冷柜、收银台……)放在存档里,玩家可以摆放和搬动(见 core/world/Placement)。

/** 轴对齐矩形:中心点 (x, z),宽 w(沿 x),深 d(沿 z)。 */
export interface Rect {
    x: number;
    z: number;
    w: number;
    d: number;
}

export type FixtureKind = 'shelf' | 'fridge' | 'glass' | 'counter' | 'computer' | 'decor';

/** 设施正面朝向的四个方向,下标 = 旋转次数(每次顺时针转 90 度)。 */
export const FRONTS: ReadonlyArray<{ x: number; z: number }> = [
    { x: 0, z: 1 },
    { x: -1, z: 0 },
    { x: 0, z: -1 },
    { x: 1, z: 0 },
];

/** 店内固定设施:既是碰撞体(collides !== false 时),也决定外观。 */
export interface Fixture extends Rect {
    id: string;
    kind: FixtureKind;
    /** 高度(米),只用于表现层。 */
    height: number;
    /** 正面朝向(单位向量,俯视平面 x/z):商品摆在这一面,顾客从这一面取货。 */
    front: { x: number; z: number };
    /** 容器类设施(货架/冷柜/展柜)可存放的格子总数。 */
    capacity?: number;
    /** 对应的设备 id(收回时放回仓库);收银台、电脑桌这类不能搬的没有。 */
    equipId?: string;
    /** 玩家能不能搬动,默认不能。 */
    movable?: boolean;
    /** 是否挡路,默认挡路。地垫、海报这类装饰为 false。 */
    collides?: boolean;
}

export interface SpawnPoint {
    x: number;
    z: number;
    /** 初始朝向角度,0 = 面朝 -z,正值向左转。 */
    yawDeg: number;
}

export interface StoreLayout {
    /** 整个可活动区域(含店外街道),玩家不能走出这个矩形。 */
    worldBounds: Rect;
    /** 室内地面矩形。 */
    interior: Rect;
    /** 墙体高度(米)。 */
    wallHeight: number;
    walls: Rect[];
    fixtures: Fixture[];
    /** 货车卸货区:到货的纸箱堆放在这里。 */
    unloadZone: Rect;
    spawn: SpawnPoint;
}

const WALL_T = 0.2;
/** 南墙(带门洞)所在的 z:扩建时南墙与门的位置不变,店向北、向两侧扩大。 */
const SOUTH_Z = 4;
const DOOR_HALF = 1;

/** 各扩建等级的店内尺寸(米)。下标 = 扩建等级,0 = 初始小店。费用与解锁等级见 core/data/Catalog 的 EXPANSIONS。 */
export const EXPANSION_SIZES: ReadonlyArray<{ w: number; d: number }> = [
    { w: 12, d: 8 },
    { w: 16, d: 10 },
    { w: 20, d: 12 },
];

export function interiorFor(expansion: number): Rect {
    const size = EXPANSION_SIZES[Math.min(Math.max(expansion, 0), EXPANSION_SIZES.length - 1)];
    return { x: 0, z: SOUTH_Z - size.d / 2, w: size.w, d: size.d };
}

/** 四面墙;南墙正中留 2 米宽的门洞,门外是街道。 */
export function wallsFor(interior: Rect): Rect[] {
    const { w, d } = interior;
    const north = interior.z - d / 2;
    const half = w / 2;
    const segW = half - DOOR_HALF + WALL_T;
    const segX = (half + WALL_T + DOOR_HALF) / 2;
    return [
        { x: 0, z: north - WALL_T / 2, w: w + WALL_T * 2, d: WALL_T }, // 北墙
        { x: -half - WALL_T / 2, z: interior.z, w: WALL_T, d }, // 西墙
        { x: half + WALL_T / 2, z: interior.z, w: WALL_T, d }, // 东墙
        { x: -segX, z: SOUTH_Z + WALL_T / 2, w: segW, d: WALL_T }, // 南墙左段
        { x: segX, z: SOUTH_Z + WALL_T / 2, w: segW, d: WALL_T }, // 南墙右段
    ];
}

/** 开局时店里的设施:3 组货架、1 台冷柜、收银台、店长电脑。货架/冷柜可以搬动。 */
export function initialFixtures(): Fixture[] {
    const south = { x: 0, z: 1 };
    return [
        // 货架宽 2.2 米,相邻货架间留 0.8 米过道(玩家直径 0.6 米);capacity = 可存放的格子数
        { id: 'shelf_1', kind: 'shelf', x: -3, z: -2.2, w: 2.2, d: 0.6, height: 1.8, front: south, capacity: 24, equipId: 'shelf', movable: true },
        { id: 'shelf_2', kind: 'shelf', x: 0, z: -2.2, w: 2.2, d: 0.6, height: 1.8, front: south, capacity: 24, equipId: 'shelf', movable: true },
        { id: 'shelf_3', kind: 'shelf', x: 3, z: -2.2, w: 2.2, d: 0.6, height: 1.8, front: south, capacity: 24, equipId: 'shelf', movable: true },
        { id: 'fridge_1', kind: 'fridge', x: 5.4, z: 0.2, w: 0.8, d: 2.0, height: 1.9, front: { x: -1, z: 0 }, capacity: 18, equipId: 'fridge', movable: true },
        { id: 'counter_1', kind: 'counter', x: 3.6, z: 2.4, w: 1.8, d: 0.8, height: 1.0, front: { x: 0, z: -1 } },
        { id: 'computer_1', kind: 'computer', x: -5.3, z: 2.4, w: 1.0, d: 0.8, height: 0.8, front: south },
    ];
}

/** 由扩建等级和当前设施组装出完整布局。 */
export function buildLayout(expansion: number, fixtures: Fixture[]): StoreLayout {
    const interior = interiorFor(expansion);
    return {
        worldBounds: { x: 0, z: 2, w: 28, d: 24 }, // x:[-14,14] z:[-10,14],扩建到最大也放得下
        interior,
        wallHeight: 3,
        walls: wallsFor(interior),
        fixtures,
        unloadZone: { x: 4.2, z: 6.8, w: 4, d: 2.4 },
        spawn: { x: 0, z: 2.8, yawDeg: 0 },
    };
}

/** 初始小店布局(扩建 0 级、初始设施),测试和新游戏用。 */
export const STREET_STORE_LAYOUT: StoreLayout = buildLayout(0, initialFixtures());

/** 会挡住玩家的东西:墙体加上所有 collides !== false 的设施。 */
export function obstaclesOf(layout: StoreLayout): Rect[] {
    return [...layout.walls, ...layout.fixtures.filter((f) => f.collides !== false)];
}

// 店铺布局数据(纯数据,不依赖引擎)。
// 坐标系:单位米,俯视平面用 (x, z),y 轴向上;朝向 yaw=0 时面朝 -z(与 Cocos 默认前方一致)。
// 后续步骤会把它迁移成 assets/data 下的 JSON 配置,并由摆放系统动态修改。

/** 轴对齐矩形:中心点 (x, z),宽 w(沿 x),深 d(沿 z)。 */
export interface Rect {
    x: number;
    z: number;
    w: number;
    d: number;
}

export type FixtureKind = 'shelf' | 'fridge' | 'counter' | 'computer';

/** 店内固定设施:既是碰撞体,也决定外观。 */
export interface Fixture extends Rect {
    id: string;
    kind: FixtureKind;
    /** 高度(米),只用于表现层。 */
    height: number;
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
    spawn: SpawnPoint;
}

// 室内 12 x 8 米,中心在原点;南墙(z=+4)正中留 2 米宽的门洞,门外是街道。
const WALL_T = 0.2;

export const STREET_STORE_LAYOUT: StoreLayout = {
    worldBounds: { x: 0, z: 3, w: 24, d: 20 }, // x:[-12,12] z:[-7,13]
    interior: { x: 0, z: 0, w: 12, d: 8 },
    wallHeight: 3,
    walls: [
        { x: 0, z: -4 - WALL_T / 2, w: 12 + WALL_T * 2, d: WALL_T }, // 北墙
        { x: -6 - WALL_T / 2, z: 0, w: WALL_T, d: 8 }, // 西墙
        { x: 6 + WALL_T / 2, z: 0, w: WALL_T, d: 8 }, // 东墙
        { x: -3.5 - WALL_T / 2, z: 4 + WALL_T / 2, w: 5 + WALL_T, d: WALL_T }, // 南墙左段(x:-6.2~-1)
        { x: 3.5 + WALL_T / 2, z: 4 + WALL_T / 2, w: 5 + WALL_T, d: WALL_T }, // 南墙右段(x:1~6.2)
    ],
    fixtures: [
        // 货架宽 2.2 米,相邻货架间留 0.8 米过道(玩家直径 0.6 米)
        { id: 'shelf_1', kind: 'shelf', x: -3, z: -2.2, w: 2.2, d: 0.6, height: 1.8 },
        { id: 'shelf_2', kind: 'shelf', x: 0, z: -2.2, w: 2.2, d: 0.6, height: 1.8 },
        { id: 'shelf_3', kind: 'shelf', x: 3, z: -2.2, w: 2.2, d: 0.6, height: 1.8 },
        { id: 'fridge_1', kind: 'fridge', x: 5.4, z: 0.2, w: 0.8, d: 2.0, height: 1.9 },
        { id: 'counter_1', kind: 'counter', x: 3.6, z: 2.4, w: 1.8, d: 0.8, height: 1.0 },
        { id: 'computer_1', kind: 'computer', x: -5.3, z: 2.4, w: 1.0, d: 0.8, height: 0.8 },
    ],
    spawn: { x: 0, z: 2.8, yawDeg: 0 },
};

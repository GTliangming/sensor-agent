// 玩家与店内设施的位置关系(纯函数)。用于"走近电脑才能使用"这类交互判定。
import type { Fixture, FixtureKind, Rect, StoreLayout } from './StoreLayout';

/** 点 (x, z) 到矩形边缘的距离;点在矩形内部返回 0。 */
export function distanceToRect(x: number, z: number, r: Rect): number {
    const dx = Math.max(Math.abs(x - r.x) - r.w / 2, 0);
    const dz = Math.max(Math.abs(z - r.z) - r.d / 2, 0);
    return Math.hypot(dx, dz);
}

/** 在 range(米)范围内找最近的指定类型设施,没有则返回 null。 */
export function findNearbyFixture(x: number, z: number, fixtures: readonly Fixture[], kind: FixtureKind, range: number): Fixture | null {
    let best: Fixture | null = null;
    let bestDist = range;
    for (const f of fixtures) {
        if (f.kind !== kind) continue;
        const d = distanceToRect(x, z, f);
        if (d <= bestDist) {
            best = f;
            bestDist = d;
        }
    }
    return best;
}

export interface Point {
    x: number;
    z: number;
}

/** 店门内外的两个路径点:顾客进出店要先经过它们,不会穿墙。 */
export const DOOR_INSIDE: Point = { x: 0, z: 3.4 };
export const DOOR_OUTSIDE: Point = { x: 0, z: 5.0 };
/** 顾客出现和离开时所在的街道位置。 */
export const STREET_SPOT: Point = { x: 0, z: 7.5 };

/** 收银台前第 index 位排队的位置(0 = 队首)。 */
export function queuePosition(layout: StoreLayout, index: number): Point {
    const counter = layout.fixtures.filter((f) => f.kind === 'counter')[0];
    const halfDepth = Math.abs(counter.front.x) * (counter.w / 2) + Math.abs(counter.front.z) * (counter.d / 2);
    const dist = halfDepth + 0.8 + index * 0.65;
    return { x: counter.x + counter.front.x * dist, z: counter.z + counter.front.z * dist };
}

/**
 * 顾客逛店时站的位置:每次(round)挑一个货架/冷柜,站在它正面。
 * 位置只由顾客编号和轮次决定,不依赖随机数,所以画面是确定的。
 */
export function browseSpot(layout: StoreLayout, customerId: number, round: number): Point {
    const boxes = layout.fixtures.filter((f) => f.capacity !== undefined);
    if (boxes.length === 0) return DOOR_INSIDE; // 所有货架都被收回时,顾客就在门口站着
    const f = boxes[(customerId * 7 + round * 3) % boxes.length];
    const lat = { x: -f.front.z, z: f.front.x };
    const halfDepth = Math.abs(f.front.x) * (f.w / 2) + Math.abs(f.front.z) * (f.d / 2);
    const halfLat = Math.abs(lat.x) * (f.w / 2) + Math.abs(lat.z) * (f.d / 2);
    const along = (((customerId * 37 + round * 11) % 100) / 100 - 0.5) * 2 * (halfLat - 0.3);
    const out = halfDepth + 0.9;
    return { x: f.x + lat.x * along + f.front.x * out, z: f.z + lat.z * along + f.front.z * out };
}

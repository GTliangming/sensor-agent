// 玩家与店内设施的位置关系(纯函数)。用于"走近电脑才能使用"这类交互判定。
import type { Fixture, FixtureKind, Rect } from './StoreLayout';

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

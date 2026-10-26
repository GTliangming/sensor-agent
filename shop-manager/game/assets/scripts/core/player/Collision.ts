// 圆形(玩家)对轴对齐矩形(墙、货架)的碰撞推出。纯函数,不依赖引擎,可直接用 node 测试。
import type { Rect } from '../world/StoreLayout';

export interface Point2 {
    x: number;
    z: number;
}

function clamp(v: number, lo: number, hi: number): number {
    return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 把圆心 (x, z)、半径 radius 的圆从所有矩形里推出来,返回修正后的位置。
 * 多个矩形相邻时一次推出可能撞进另一个,所以最多迭代几轮直到稳定。
 */
export function resolveCircleAgainstRects(x: number, z: number, radius: number, rects: readonly Rect[]): Point2 {
    for (let iter = 0; iter < 4; iter++) {
        let moved = false;
        for (const r of rects) {
            const minX = r.x - r.w / 2;
            const maxX = r.x + r.w / 2;
            const minZ = r.z - r.d / 2;
            const maxZ = r.z + r.d / 2;

            // 矩形上离圆心最近的点
            const nx = clamp(x, minX, maxX);
            const nz = clamp(z, minZ, maxZ);
            const dx = x - nx;
            const dz = z - nz;
            const dist2 = dx * dx + dz * dz;
            if (dist2 >= radius * radius) continue;

            if (dist2 > 1e-12) {
                // 圆心在矩形外:沿"最近点 -> 圆心"方向推出
                const dist = Math.sqrt(dist2);
                const push = radius - dist;
                x += (dx / dist) * push;
                z += (dz / dist) * push;
            } else {
                // 圆心已落在矩形内:朝最近的一条边推出
                const toLeft = x - minX;
                const toRight = maxX - x;
                const toTop = z - minZ;
                const toBottom = maxZ - z;
                const m = Math.min(toLeft, toRight, toTop, toBottom);
                if (m === toLeft) x = minX - radius;
                else if (m === toRight) x = maxX + radius;
                else if (m === toTop) z = minZ - radius;
                else z = maxZ + radius;
            }
            moved = true;
        }
        if (!moved) break;
    }
    return { x, z };
}

/** 把圆限制在一个矩形区域内部。 */
export function clampCircleInRect(x: number, z: number, radius: number, bounds: Rect): Point2 {
    return {
        x: clamp(x, bounds.x - bounds.w / 2 + radius, bounds.x + bounds.w / 2 - radius),
        z: clamp(z, bounds.z - bounds.d / 2 + radius, bounds.z + bounds.d / 2 - radius),
    };
}

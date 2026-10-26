// 等级与经验:累计经验达到阈值就升级。每级解锁的商品/设备来自目录里的 unlockLevel,不在这里重复写。
import { EQUIPMENT, GOODS } from './Catalog';

export const MAX_LEVEL = 10;

/** LEVEL_XP[n] = 升到 n 级所需的累计经验(下标 0 不用)。 */
export const LEVEL_XP = [0, 0, 100, 300, 600, 1000, 1600, 2400, 3400, 4600, 6000];

/** 该经验值对应的等级。 */
export function levelForXp(xp: number): number {
    let level = 1;
    while (level < MAX_LEVEL && xp >= LEVEL_XP[level + 1]) level++;
    return level;
}

/** 升到某级所需的累计经验。 */
export function xpForLevel(level: number): number {
    return LEVEL_XP[Math.min(Math.max(level, 1), MAX_LEVEL)];
}

/** 距离下一级还需要的累计经验门槛;已满级返回 null。 */
export function nextLevelXp(level: number): number | null {
    return level >= MAX_LEVEL ? null : LEVEL_XP[level + 1];
}

/** 升到该级新解锁的商品与设备名称。 */
export function unlocksAtLevel(level: number): string[] {
    const names: string[] = [];
    for (const g of GOODS) if (g.unlockLevel === level) names.push(g.name);
    for (const e of EQUIPMENT) if (e.unlockLevel === level) names.push(e.name);
    return names;
}

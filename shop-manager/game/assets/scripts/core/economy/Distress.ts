// 资金紧张(温和失败)的判定。不会删档,只限制采购设备,并给出补救办法(见 GameSession)。
import { DISTRESS } from '../data/Balance';
import { GOODS } from '../data/Catalog';
import type { GameState } from '../state/GameState';

/** 现在是不是资金紧张:已经连续几天"金币很少又没货可卖",并且金币还没回到恢复线。 */
export function isDistressed(state: GameState): boolean {
    return state.distressDays >= DISTRESS.days && state.coins < DISTRESS.recoverCoins;
}

/** 新的一天开始时调用:金币很少、货架没货、没有在途订单和纸箱,连续天数 +1,否则清零。 */
export function nextDistressDays(state: GameState): number {
    const stuck = state.coins < DISTRESS.coinsBelow && Object.keys(state.stock).length === 0 && state.orders.length === 0 && state.cartons.length === 0;
    return stuck ? state.distressDays + 1 : 0;
}

/**
 * 进入资金紧张时的一次性救济("供货商先赊一批货,街坊愿意再给一次机会"):
 * 在卸货区放几批最便宜的、店里有容器能摆的商品(白送,没有上架经验),并把满意度托到至少 reliefSatisfaction。
 * 没有它,玩家会卡在"没钱进货 -> 没货可卖 -> 满意度跌光 -> 客流只剩一点点"的死循环里。
 * 返回送出的商品名,用来提示玩家。
 */
export function grantRelief(state: GameState): string[] {
    const kinds = state.fixtures.map((f) => f.kind as string);
    const picks = GOODS.filter((g) => g.unlockLevel <= state.level && kinds.indexOf(g.container) >= 0)
        .sort((a, b) => a.unitCost * a.batchSize - b.unitCost * b.batchSize || (a.id < b.id ? -1 : 1))
        .slice(0, DISTRESS.reliefBatches);
    for (const g of picks) {
        state.cartons.push({ id: state.nextCartonId++, orderId: null, itemId: g.id, units: g.batchSize, location: 'door', xpLeft: 0 });
    }
    state.satisfaction = Math.max(state.satisfaction, DISTRESS.reliefSatisfaction);
    return picks.map((g) => g.name);
}

// 招商:商户入驻档口,每天自动收租;满意度持续偏低或事故频发,商户会预警后解约搬走。
// 本文件只改 state 并返回通知,命令(签约/续约/收回)在 GameSession 里。
import { MERCHANT } from '../data/Balance';
import { getMerchant } from '../data/Merchants';
import type { GameState, MerchantLease } from '../state/GameState';

export type MerchantNotice =
    | { type: 'rent'; merchantId: string; amount: number }
    | { type: 'warning'; merchantId: string }
    | { type: 'left'; merchantId: string; reason: 'unhappy' | 'expired' };

/** 档口数量 = 扩建次数(初始小店没有档口)。 */
export function slotCount(state: GameState): number {
    return state.expansion;
}

export function merchantsUnlocked(state: GameState): boolean {
    return state.level >= MERCHANT.unlockLevel && state.expansion >= MERCHANT.minExpansion;
}

export function leaseAt(state: GameState, slot: number): MerchantLease | undefined {
    return state.merchants.filter((l) => l.slot === slot)[0];
}

export function renewFee(merchantId: string): number {
    const def = getMerchant(merchantId);
    return def ? Math.round(def.deposit * MERCHANT.renewFeeRatio) : 0;
}

/**
 * 新的一天开始时调用(state.day 已经是新的一天):
 * 收昨天的租金;评估昨天是不是"糟糕的一天"(满意度低或事故多),第一次预警,连续糟糕则解约;租约到期的搬走。
 * 解约和到期都退还押金。
 */
export function settleMerchantsNewDay(state: GameState): MerchantNotice[] {
    const notices: MerchantNotice[] = [];
    const kept: MerchantLease[] = [];
    for (const lease of state.merchants) {
        const def = getMerchant(lease.merchantId);
        if (!def) continue; // 配置里已经没有的商户:直接丢弃
        state.coins += def.rentPerDay;
        notices.push({ type: 'rent', merchantId: def.id, amount: def.rentPerDay });

        const bad = state.satisfaction < MERCHANT.minSatisfaction || state.incidentsToday >= MERCHANT.maxIncidents;
        lease.badDays = bad ? lease.badDays + 1 : 0;
        if (lease.badDays >= MERCHANT.badDaysToLeave) {
            state.coins += def.deposit;
            notices.push({ type: 'left', merchantId: def.id, reason: 'unhappy' });
            continue;
        }
        if (lease.expiresDay < state.day) {
            state.coins += def.deposit;
            notices.push({ type: 'left', merchantId: def.id, reason: 'expired' });
            continue;
        }
        if (bad) notices.push({ type: 'warning', merchantId: def.id });
        kept.push(lease);
    }
    state.merchants = kept;
    return notices;
}

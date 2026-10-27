// 激励广告的每日次数上限。只读写 state.ads;跨天后自动当作清零。
// 查询(adRemaining)不修改状态;只有真正消耗/退回次数时才会重置过期的记录。
import { ADS } from '../data/Balance';
import type { GameState } from '../state/GameState';
import type { AdPlacement } from '../services/AdProvider';

/** 今天各场景已经看过的次数(记录是昨天的就当作空)。 */
function usedToday(state: GameState): { [placement: string]: number } {
    return state.ads.day === state.day ? state.ads.used : {};
}

/** 今天这个场景还能看几次。资金紧张时金币广告的次数更多。 */
export function adRemaining(state: GameState, placement: AdPlacement, distress: boolean): number {
    const extra = placement === 'coins' && distress ? ADS.distressExtraCoinAds : 0;
    return Math.max(0, (ADS.dailyCap[placement] ?? 0) + extra - (usedToday(state)[placement] ?? 0));
}

/** 消耗一次;已经用完返回 false。 */
export function consumeAd(state: GameState, placement: AdPlacement, distress: boolean): boolean {
    if (adRemaining(state, placement, distress) < 1) return false;
    if (state.ads.day !== state.day) state.ads = { day: state.day, used: {} };
    state.ads.used[placement] = (state.ads.used[placement] ?? 0) + 1;
    return true;
}

/** 退回一次(广告看完了但后续命令失败时用)。 */
export function refundAd(state: GameState, placement: AdPlacement): void {
    if (state.ads.day !== state.day) return;
    state.ads.used[placement] = Math.max(0, (state.ads.used[placement] ?? 0) - 1);
}

// 员工:收银员自动扫码收款,理货员自动把卸货区的箱子上架/入仓库。
// 员工和玩家走同一批命令(scanCustomer / collectPayment 等),所以库存、金币、经验的结果和玩家亲手做完全一致。
import { STAFF } from '../data/Balance';
import type { GameState, StaffRole } from '../state/GameState';

export type StaffNotice = { type: 'paid'; total: number } | { type: 'quit'; role: StaffRole };

export const STAFF_ROLES: StaffRole[] = ['cashier', 'stocker'];

export function hasStaff(state: GameState, role: StaffRole): boolean {
    return state.staff.some((s) => s.role === role);
}

export function dailyWages(state: GameState): number {
    let total = 0;
    for (const s of state.staff) total += STAFF[s.role].wage;
    return total;
}

/** 新的一天开始时发工资。金币不够发某个员工的工资,他就离职(按雇佣先后依次发)。 */
export function settleWagesNewDay(state: GameState): StaffNotice[] {
    const notices: StaffNotice[] = [];
    const kept: GameState['staff'] = [];
    let paid = 0;
    for (const s of state.staff) {
        const wage = STAFF[s.role].wage;
        if (state.coins >= wage) {
            state.coins -= wage;
            paid += wage;
            kept.push(s);
        } else {
            notices.push({ type: 'quit', role: s.role });
        }
    }
    state.staff = kept;
    if (paid > 0) notices.unshift({ type: 'paid', total: paid });
    return notices;
}

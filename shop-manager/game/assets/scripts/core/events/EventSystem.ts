// 突发事件框架:触发(按概率与条件)-> 弹出提示并倒计时 -> 玩家选择应对 / 超时自动产生负面结果。
// 妥善处理有奖励;每种事件的损失都有上限,不会让玩家一次事件就无法继续。数值在 core/data/Balance.ts 的 EVENTS。
// 本文件只改 state 并返回结果描述,经验与升级由 GameSession 处理。
import type { Rng } from '../base/Rng';
import { addSatisfaction } from '../customers/CustomerSystem';
import { EVENTS, isBeginnerProtected } from '../data/Balance';
import { GOODS, getCatalogItem } from '../data/Catalog';
import { stockedUnits, takeFromShelves } from '../inventory/Inventory';
import type { ActiveEvent, EventType, GameState } from '../state/GameState';
import type { StoreLayout } from '../world/StoreLayout';

export interface EventOption {
    id: string;
    label: string;
    /** 选这个选项要花的金币。 */
    cost: number;
}

export interface EventDescription {
    title: string;
    body: string;
    options: EventOption[];
}

/** 处理结果:handled = 妥善处理了(有奖励);xp 由调用方发放。 */
export interface EventOutcome {
    handled: boolean;
    message: string;
    xp: number;
}

export type RespondResult = { ok: true; outcome: EventOutcome } | { ok: false; reason: string; code: 'insufficient_coins' | 'invalid' };

const IGNORE: EventOption = { id: 'ignore', label: '不理会', cost: 0 };

/** 容易变质的品类:会遇到"快过期"。 */
const PERISHABLE_CATEGORIES = ['冷冻品', '生鲜', '糕点'];

const itemName = (id: string | null) => (id ? getCatalogItem(id)?.name ?? id : '');

/** 给界面用的标题、说明和可选项。 */
export function describeEvent(ev: ActiveEvent): EventDescription {
    switch (ev.type) {
        case 'rain_puddle':
            return {
                title: '门口积水了',
                body: '暴雨把门口淋湿了,顾客容易滑倒。尽快清理,否则会被差评。',
                options: [{ id: 'clean', label: '请人清理积水', cost: EVENTS.rain.cleanCost }, IGNORE],
            };
        case 'heat_fridge':
            return {
                title: '冷柜过热',
                body: '高温让冷柜压缩机超负荷,再不检修可能停转,里面的冷冻品会化掉。',
                options: [{ id: 'maintain', label: '检修冷柜', cost: EVENTS.heat.maintainCost }, IGNORE],
            };
        case 'wind_sign':
            return {
                title: '招牌松动了',
                body: '大风把门头招牌吹得摇摇欲坠,不加固可能被吹落,重新买更贵。',
                options: [{ id: 'reinforce', label: '加固招牌', cost: EVENTS.wind.reinforceCost }, IGNORE],
            };
        case 'supplier_discount':
            return {
                title: '供货商限时打折',
                body: `今天所有进货享受 ${Math.round(EVENTS.supplier.factor * 10)} 折,适合囤货。`,
                options: [{ id: 'accept', label: '抓住机会', cost: 0 }, { id: 'ignore', label: '算了', cost: 0 }],
            };
        case 'expiring':
            return {
                title: `${itemName(ev.itemId)}快过期了`,
                body: '这批货保质期快到了。打折促销可以减少亏损,放着不管会被扔掉一部分。',
                options: [{ id: 'promo', label: `打 ${Math.round(EVENTS.expiring.promoFactor * 10)} 折促销`, cost: 0 }, IGNORE],
            };
        case 'blackout':
            return {
                title: '停电了',
                body: '店里突然停电,冷柜停止工作,冷冻品开始化冻。叫电工抢修要花钱,拖久了损失更大。',
                options: [{ id: 'repair', label: '叫电工抢修', cost: EVENTS.blackout.repairCost }, IGNORE],
            };
    }
}

// ---------------------------------------------------------------- 触发

const hasFridge = (state: GameState) => state.fixtures.some((f) => f.kind === 'fridge');

/** 货架/冷柜里件数 >= minUnits 的易变质商品(随机挑一个)。 */
function pickPerishable(state: GameState, rng: Rng): string | null {
    const candidates = GOODS.filter((g) => PERISHABLE_CATEGORIES.indexOf(g.category) >= 0 && stockedUnits(state, g.id) >= EVENTS.expiring.minUnits);
    return candidates.length > 0 ? candidates[rng.int(0, candidates.length - 1)].id : null;
}

/** 某类事件现在能不能发生,以及相对权重(0 = 不能)。 */
function weightOf(type: EventType, state: GameState, rng: Rng): number {
    if (state.events.some((e) => e.type === type)) return 0;
    const protectedDays = isBeginnerProtected(state.day);
    switch (type) {
        case 'rain_puddle':
            return 0; // 只在下雨天开始时由系统直接触发
        case 'supplier_discount':
            return state.supplierDiscount && state.supplierDiscount.untilDay >= state.day ? 0 : 1;
        case 'heat_fridge':
            return protectedDays || !hasFridge(state) ? 0 : state.weather === 'hot' ? 3 : 0.4;
        case 'wind_sign':
            return protectedDays ? 0 : state.weather === 'wind' ? 3 : 0.3;
        case 'expiring':
            return protectedDays || pickPerishable(state, rng) === null ? 0 : 1;
        case 'blackout':
            return protectedDays || state.level < 2 || !hasFridge(state) ? 0 : 0.5;
    }
}

const ALL_TYPES: EventType[] = ['rain_puddle', 'heat_fridge', 'wind_sign', 'supplier_discount', 'expiring', 'blackout'];

/** 按权重随机挑一个可触发的事件(没有则 null)。 */
export function pickEvent(state: GameState, rng: Rng): { type: EventType; itemId: string | null } | null {
    const weights = ALL_TYPES.map((t) => weightOf(t, state, rng));
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return null;
    let r = rng.next() * total;
    for (let i = 0; i < ALL_TYPES.length; i++) {
        r -= weights[i];
        if (r < 0) {
            const type = ALL_TYPES[i];
            return { type, itemId: type === 'expiring' ? pickPerishable(state, rng) : null };
        }
    }
    return null;
}

// ---------------------------------------------------------------- 结算

/** 冷柜里的易腐商品损失:从所有冷柜里取走最多 maxUnits 件,返回实际损失件数。 */
function loseFridgeUnits(state: GameState, layout: StoreLayout, maxUnits: number): number {
    let lost = 0;
    for (const g of GOODS) {
        if (g.container !== 'fridge' || lost >= maxUnits) continue;
        for (const line of takeFromShelves(state, layout, g.id, maxUnits - lost)) lost += line.units;
    }
    return lost;
}

/** 妥善处理的奖励:满意度 + 经验。 */
function withBonus(state: GameState, message: string): EventOutcome {
    addSatisfaction(state, EVENTS.handledSatisfaction);
    return { handled: true, message: `${message}(处理得当:满意度 +${EVENTS.handledSatisfaction},经验 +${EVENTS.handledXp})`, xp: EVENTS.handledXp };
}

/** 玩家选择了某个应对选项。选"不理会"等同于超时。 */
export function respondToEvent(state: GameState, layout: StoreLayout, ev: ActiveEvent, optionId: string): RespondResult {
    const option = describeEvent(ev).options.filter((o) => o.id === optionId)[0];
    if (!option) return { ok: false, reason: '没有这个选项', code: 'invalid' };
    if (optionId === 'ignore') return { ok: true, outcome: timeoutEvent(state, layout, ev) };
    if (state.coins < option.cost) return { ok: false, reason: `金币不足,还差 ${option.cost - state.coins}`, code: 'insufficient_coins' };
    state.coins -= option.cost;

    switch (ev.type) {
        case 'rain_puddle':
            return { ok: true, outcome: withBonus(state, '积水清理干净了') };
        case 'heat_fridge':
            return { ok: true, outcome: withBonus(state, '冷柜检修好了,运转正常') };
        case 'wind_sign':
            return { ok: true, outcome: withBonus(state, '招牌加固好了') };
        case 'blackout':
            return { ok: true, outcome: withBonus(state, '电工抢修成功,冷柜恢复了') };
        case 'supplier_discount':
            state.supplierDiscount = { factor: EVENTS.supplier.factor, untilDay: state.day };
            return { ok: true, outcome: withBonus(state, `今天进货 ${Math.round(EVENTS.supplier.factor * 10)} 折,快去电脑下单`) };
        case 'expiring':
            if (ev.itemId) state.priceFactors[ev.itemId] = { factor: EVENTS.expiring.promoFactor, untilDay: state.day };
            return { ok: true, outcome: withBonus(state, `${itemName(ev.itemId)}促销到今天结束,别砸手里`) };
    }
}

/** 倒计时结束(或选了"不理会"):产生负面结果,损失有上限。 */
export function timeoutEvent(state: GameState, layout: StoreLayout, ev: ActiveEvent): EventOutcome {
    const miss = (message: string): EventOutcome => ({ handled: false, message, xp: 0 });
    switch (ev.type) {
        case 'rain_puddle': {
            const penalty = isBeginnerProtected(state.day) ? EVENTS.rain.protectedPenalty : EVENTS.rain.timeoutPenalty;
            addSatisfaction(state, penalty);
            return miss(`积水没处理,有顾客滑倒差评:满意度 ${penalty}`);
        }
        case 'heat_fridge': {
            const lost = loseFridgeUnits(state, layout, Math.min(EVENTS.heat.lossUnits, EVENTS.lossCapUnits));
            addSatisfaction(state, EVENTS.heat.penalty);
            return miss(`冷柜过热停转,损失了 ${lost} 件冷冻/生鲜商品,满意度 ${EVENTS.heat.penalty}`);
        }
        case 'wind_sign': {
            const pay = Math.min(state.coins, EVENTS.wind.replaceCost, EVENTS.lossCapCoins);
            state.coins -= pay;
            addSatisfaction(state, EVENTS.wind.penalty);
            return miss(`招牌被吹落了,重新买花了 ${pay} 金币,满意度 ${EVENTS.wind.penalty}`);
        }
        case 'blackout': {
            const lost = loseFridgeUnits(state, layout, Math.min(EVENTS.blackout.lossUnits, EVENTS.lossCapUnits));
            addSatisfaction(state, EVENTS.blackout.penalty);
            return miss(`停电太久,损失了 ${lost} 件冷冻/生鲜商品,满意度 ${EVENTS.blackout.penalty}`);
        }
        case 'expiring': {
            const total = ev.itemId ? stockedUnits(state, ev.itemId) : 0;
            const want = Math.min(Math.ceil(total * EVENTS.expiring.lossRatio), EVENTS.lossCapUnits);
            let lost = 0;
            if (ev.itemId && want > 0) for (const line of takeFromShelves(state, layout, ev.itemId, want)) lost += line.units;
            addSatisfaction(state, EVENTS.expiring.penalty);
            return miss(`${itemName(ev.itemId)}过期了,扔掉 ${lost} 件,满意度 ${EVENTS.expiring.penalty}`);
        }
        case 'supplier_discount':
            return miss('错过了供货商打折');
    }
}

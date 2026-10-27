// 突发事件框架:触发(按概率与条件)-> 弹出提示并倒计时 -> 玩家选择应对 / 超时自动产生负面结果。
// 妥善处理有奖励;每种事件的损失都有上限,不会让玩家一次事件就无法继续。数值在 core/data/Balance.ts 的 EVENTS。
// 本文件只改 state 并返回结果描述,经验与升级由 GameSession 处理。
import type { Rng } from '../base/Rng';
import { addSatisfaction } from '../customers/CustomerSystem';
import { CUSTOMER, EVENTS, isBeginnerProtected } from '../data/Balance';
import { GOODS, getCatalogItem } from '../data/Catalog';
import { stockedUnits, returnCart, takeFromShelves } from '../inventory/Inventory';
import { ActiveEvent, EVENT_TYPES, EventType, GameState, PriceFactor } from '../state/GameState';
import { unreachablePlace } from '../world/Placement';
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

/** 店里有没有摆灭火器(消防事件与抽查都看这个)。 */
export function hasExtinguisher(state: GameState): boolean {
    return state.fixtures.some((f) => f.equipId === 'extinguisher');
}

/** 给界面用的标题、说明和可选项。传入 state 时,选项文字会反映当前店里的情况(如有没有灭火器)。 */
export function describeEvent(ev: ActiveEvent, state?: GameState): EventDescription {
    const hasExt = state ? hasExtinguisher(state) : true;
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
        case 'fire':
            return {
                title: '店里冒烟起火了',
                body: '货架附近冒出浓烟。有灭火器可以直接扑灭;没有的话只能先疏散顾客,货物会有损失。',
                options: [
                    { id: 'extinguish', label: hasExt ? '用灭火器灭火' : '灭火(店里没有灭火器)', cost: 0 },
                    { id: 'evacuate', label: '疏散顾客,等消防来', cost: 0 },
                    IGNORE,
                ],
            };
        case 'inspection':
            return {
                title: '消防检查员上门了',
                body: '检查员要看通道是否畅通、有没有灭火器。倒计时内可以先整改,准备好再接受检查;拒绝检查会被罚款。',
                options: [{ id: 'cooperate', label: '接受检查', cost: 0 }, { id: 'ignore', label: '拒绝检查', cost: 0 }],
            };
        case 'price_war':
            return {
                title: '对面超市打起价格战',
                body: `对面大幅降价抢客。你打算怎么应对?(影响持续 ${EVENTS.priceWar.days} 天,不选会流失更多顾客)`,
                options: [
                    { id: 'follow', label: `跟着降价(全场 ${Math.round(EVENTS.priceWar.followPriceFactor * 10)} 折)`, cost: 0 },
                    { id: 'loyal', label: `靠口碑留客(满意度需 ${EVENTS.priceWar.loyalMinSatisfaction}+)`, cost: 0 },
                    { id: 'poster', label: '摆促销海报', cost: EVENTS.priceWar.posterCost },
                ],
            };
        case 'competitor_open':
            return {
                title: '附近开了一家新超市',
                body: `新店开业,接下来 ${EVENTS.competitor.openDays} 天会分走一部分客流。搞个开业对冲活动可以少流失一些。`,
                options: [{ id: 'promo', label: '做促销活动', cost: EVENTS.competitor.promoCost }, IGNORE],
            };
        case 'competitor_close':
            return {
                title: '附近的竞争对手倒闭了',
                body: `原来的顾客需要新的去处。主动拉客可以让接下来 ${EVENTS.competitor.closeDays} 天的客流变多(×${EVENTS.competitor.closeTraffic}),放着不管就没有变化。`,
                options: [{ id: 'welcome', label: '欢迎新顾客', cost: 0 }, { id: 'ignore', label: '顺其自然', cost: 0 }],
            };
        case 'supplier_stolen':
            return {
                title: '常用供货商被对手抢走',
                body: `供货商转去供应竞争对手,换新渠道会让进货变贵(${EVENTS.supplierStolen.days} 天内约 ${Math.round((EVENTS.supplierStolen.costFactor - 1) * 100)}%)。出面谈判可以保住原价。`,
                options: [{ id: 'negotiate', label: '登门谈判', cost: EVENTS.supplierStolen.negotiateCost }, IGNORE],
            };
    }
}

// ---------------------------------------------------------------- 触发

/**
 * 事件保护:新手保护期,或者玩家正处境艰难(满意度跌进低谷、金币见底)时,
 * 只会来供货商打折、下雨积水(惩罚减半)这类无害或轻微的事件,不再出火情、停电、竞争这些要花钱应对的事件。
 * 这是"温和失败"的一部分:越惨越不该被事件继续踩。
 */
export function isEventShielded(state: GameState): boolean {
    return isBeginnerProtected(state.day) || state.satisfaction < CUSTOMER.lowSatThreshold || state.coins < EVENTS.shieldBelowCoins;
}

const hasFridge = (state: GameState) => state.fixtures.some((f) => f.kind === 'fridge');

/** 限时系数当前的值(没有或已过期为 1)。 */
export function activeFactor(state: GameState, f: PriceFactor | null): number {
    return f && f.untilDay >= state.day ? f.factor : 1;
}

/** 叠加一个限时系数:与仍有效的旧系数相乘,持续到更晚的那个日期。 */
export function applyFactor(state: GameState, slot: 'traffic' | 'supplyCost' | 'salePrice', factor: number, days: number): void {
    const old = state.market[slot];
    const oldFactor = activeFactor(state, old);
    const untilDay = Math.max(state.day + days - 1, old && old.untilDay >= state.day ? old.untilDay : 0);
    state.market[slot] = { factor: oldFactor * factor, untilDay };
}

/** 货架/冷柜里件数 >= minUnits 的易变质商品(随机挑一个)。 */
function pickPerishable(state: GameState, rng: Rng): string | null {
    const candidates = GOODS.filter((g) => PERISHABLE_CATEGORIES.indexOf(g.category) >= 0 && stockedUnits(state, g.id) >= EVENTS.expiring.minUnits);
    return candidates.length > 0 ? candidates[rng.int(0, candidates.length - 1)].id : null;
}

/** 某类事件现在能不能发生,以及相对权重(0 = 不能)。 */
function weightOf(type: EventType, state: GameState, rng: Rng): number {
    if (state.events.some((e) => e.type === type)) return 0;
    const protectedDays = isEventShielded(state);
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
        case 'fire':
            return protectedDays || state.level < EVENTS.fireMinLevel ? 0 : 0.4;
        case 'inspection':
            return protectedDays || state.level < EVENTS.fireMinLevel ? 0 : 0.4;
        case 'price_war':
        case 'competitor_open':
        case 'competitor_close':
            // 上一轮市场影响还没结束时不再叠加新的客流事件
            return protectedDays || state.level < EVENTS.competitionMinLevel || activeFactor(state, state.market.traffic) !== 1 ? 0 : 0.3;
        case 'supplier_stolen':
            return protectedDays || state.level < EVENTS.competitionMinLevel || activeFactor(state, state.market.supplyCost) !== 1 ? 0 : 0.3;
    }
}

const ALL_TYPES: ReadonlyArray<EventType> = EVENT_TYPES;

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

/** 从所有货架/冷柜里取走最多 maxUnits 件商品(不分品类),返回实际损失件数。 */
function loseShelfUnits(state: GameState, layout: StoreLayout, maxUnits: number): number {
    let lost = 0;
    for (const g of GOODS) {
        if (lost >= maxUnits) break;
        for (const line of takeFromShelves(state, layout, g.id, maxUnits - lost)) lost += line.units;
    }
    return lost;
}

/** 火情疏散:所有顾客离店,购物车里的商品放回货架;不扣满意度(是为了安全)。 */
function evacuateCustomers(state: GameState, layout: StoreLayout): void {
    for (const c of state.customers) {
        if (c.phase === 'queuing') {
            returnCart(state, layout, c.cart);
            state.today.lost++;
        }
    }
    state.customers = [];
    state.spawnProgress = 0;
}

/** 消防检查:返回不合格的原因列表(空 = 合格)。 */
export function inspectionProblems(state: GameState, layout: StoreLayout): string[] {
    const problems: string[] = [];
    if (!hasExtinguisher(state)) problems.push('没有摆灭火器');
    const blocked = unreachablePlace(layout);
    if (blocked) problems.push(`通道不畅:${blocked}`);
    return problems;
}

/** 检查不合格或拒绝检查:罚款(有上限,金币不够就扣到 0)并扣满意度。 */
function inspectionFailed(state: GameState, reasons: string): EventOutcome {
    const fine = Math.min(state.coins, EVENTS.inspection.fine, EVENTS.lossCapCoins);
    state.coins -= fine;
    addSatisfaction(state, EVENTS.inspection.penalty);
    return { handled: false, message: `消防检查不合格(${reasons}),罚款 ${fine} 金币,满意度 ${EVENTS.inspection.penalty}`, xp: 0 };
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
        case 'fire': {
            if (optionId === 'extinguish') {
                if (!hasExtinguisher(state)) {
                    return { ok: false, reason: '店里没有灭火器,先疏散顾客吧(以后记得摆一个)', code: 'invalid' };
                }
                return { ok: true, outcome: withBonus(state, '及时用灭火器扑灭了火') };
            }
            // 疏散:保住了人,货物和设备仍有较小损失,不算妥善处理
            evacuateCustomers(state, layout);
            const coins = Math.min(state.coins, EVENTS.fire.evacuateCoins, EVENTS.lossCapCoins);
            state.coins -= coins;
            const lost = loseShelfUnits(state, layout, Math.min(EVENTS.fire.evacuateUnits, EVENTS.lossCapUnits));
            addSatisfaction(state, EVENTS.fire.evacuatePenalty);
            return {
                ok: true,
                outcome: { handled: false, message: `顾客安全撤离,火烧了一阵才灭:损失 ${coins} 金币、${lost} 件商品,满意度 ${EVENTS.fire.evacuatePenalty}`, xp: 0 },
            };
        }
        case 'inspection': {
            const problems = inspectionProblems(state, layout);
            if (problems.length > 0) return { ok: true, outcome: inspectionFailed(state, problems.join('、')) };
            state.coins += EVENTS.inspection.rewardCoins;
            return { ok: true, outcome: withBonus(state, `消防检查合格,获得奖励 ${EVENTS.inspection.rewardCoins} 金币`) };
        }
        case 'price_war': {
            const pw = EVENTS.priceWar;
            if (optionId === 'follow') {
                applyFactor(state, 'salePrice', pw.followPriceFactor, pw.days);
                return { ok: true, outcome: withBonus(state, `全场 ${Math.round(pw.followPriceFactor * 10)} 折,客流保住了,但利润变薄`) };
            }
            if (optionId === 'loyal') {
                if (state.satisfaction >= pw.loyalMinSatisfaction) return { ok: true, outcome: withBonus(state, '老顾客认你的口碑,客流没有受影响') };
                applyFactor(state, 'traffic', pw.loyalFailTraffic, pw.days);
                return { ok: true, outcome: { handled: false, message: `口碑还不够硬(需要满意度 ${pw.loyalMinSatisfaction}),${pw.days} 天内客流 ×${pw.loyalFailTraffic}`, xp: 0 } };
            }
            applyFactor(state, 'traffic', pw.posterTraffic, pw.days);
            return { ok: true, outcome: withBonus(state, `促销海报贴出去了,${pw.days} 天内客流只小幅下降(×${pw.posterTraffic})`) };
        }
        case 'competitor_open': {
            const c = EVENTS.competitor;
            applyFactor(state, 'traffic', c.promoTraffic, c.openDays);
            return { ok: true, outcome: withBonus(state, `促销活动留住了不少顾客,${c.openDays} 天内客流 ×${c.promoTraffic}`) };
        }
        case 'competitor_close': {
            const c = EVENTS.competitor;
            applyFactor(state, 'traffic', c.closeTraffic, c.closeDays);
            return { ok: true, outcome: withBonus(state, `接住了对手的顾客,${c.closeDays} 天内客流 ×${c.closeTraffic}`) };
        }
        case 'supplier_stolen':
            return { ok: true, outcome: withBonus(state, '谈判成功,原来的进货价保住了') };
    }
}

/** 倒计时结束(或选了"不理会"):产生负面结果,损失有上限。 */
export function timeoutEvent(state: GameState, layout: StoreLayout, ev: ActiveEvent): EventOutcome {
    const miss = (message: string): EventOutcome => ({ handled: false, message, xp: 0 });
    switch (ev.type) {
        case 'rain_puddle': {
            const penalty = isEventShielded(state) ? EVENTS.rain.protectedPenalty : EVENTS.rain.timeoutPenalty;
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
        case 'fire': {
            // 没人灭火:烧掉一部分货和设备,金币与件数都有上限
            const coins = Math.min(state.coins, EVENTS.fire.timeoutCoins, EVENTS.lossCapCoins);
            state.coins -= coins;
            const lost = loseShelfUnits(state, layout, Math.min(EVENTS.fire.timeoutUnits, EVENTS.lossCapUnits));
            addSatisfaction(state, EVENTS.fire.penalty);
            return miss(`火越烧越大:损失 ${coins} 金币、${lost} 件商品,满意度 ${EVENTS.fire.penalty}`);
        }
        case 'inspection':
            return inspectionFailed(state, '拒绝配合检查');
        case 'price_war': {
            const pw = EVENTS.priceWar;
            applyFactor(state, 'traffic', pw.timeoutTraffic, pw.days);
            addSatisfaction(state, pw.timeoutPenalty);
            return miss(`没有应对价格战,顾客被抢走了一部分:${pw.days} 天内客流 ×${pw.timeoutTraffic}`);
        }
        case 'competitor_open': {
            const c = EVENTS.competitor;
            applyFactor(state, 'traffic', c.openTraffic, c.openDays);
            return miss(`新超市分走了客流:${c.openDays} 天内客流 ×${c.openTraffic}`);
        }
        case 'competitor_close':
            return miss('没有主动拉客,对手的顾客自己散了');
        case 'supplier_stolen': {
            const s = EVENTS.supplierStolen;
            applyFactor(state, 'supplyCost', s.costFactor, s.days);
            return miss(`供货商被抢走,${s.days} 天内进货价 ×${s.costFactor}`);
        }
    }
}

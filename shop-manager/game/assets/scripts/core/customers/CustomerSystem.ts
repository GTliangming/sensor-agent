// 顾客系统:生成顾客 -> 逛店取货 -> 排队 -> 玩家扫码收款 / 等太久生气离开。
// 纯逻辑,不涉及位置与画面:顾客只有"状态 + 计时",3D 里走到哪由表现层推算。随机全部来自 Rng,行为可复现。
import type { Rng } from '../base/Rng';
import { CUSTOMER, SATISFACTION, SURVEY } from '../data/Balance';
import { GOODS, getCatalogItem } from '../data/Catalog';
import { returnCart, stockedUnits, takeFromShelves } from '../inventory/Inventory';
import type { CartLine, Customer, GameState, WantLine } from '../state/GameState';
import type { StoreLayout } from '../world/StoreLayout';
import { kindForCustomer, recordExit } from './Feedback';
import { addSatisfaction } from './Satisfaction';

export type CustomerNotice =
    | { type: 'noStock'; customerId: number }
    | { type: 'queueFull'; customerId: number }
    | { type: 'angry'; customerId: number }
    | { type: 'kickedOut'; customerId: number };

export type ScanResult = { ok: true } | { ok: false; reason: string };
export type CollectResult =
    | { ok: true; total: number; units: number; surveyReward: boolean }
    | { ok: false; reason: string };

/** 满意度越高客流越大;低于阈值时客流骤减。单位:每分钟来几位。 */
export function spawnRatePerMinute(satisfaction: number): number {
    if (satisfaction < CUSTOMER.lowSatThreshold) return CUSTOMER.lowSatPerMin;
    return CUSTOMER.spawnBasePerMin + (Math.min(satisfaction, 100) / 100) * CUSTOMER.spawnPerSatPerMin;
}

export { addSatisfaction };

/** 排队的顾客,按先后顺序(队首在前)。 */
export function queueOf(state: GameState): Customer[] {
    return state.customers.filter((c) => c.phase === 'queuing').sort((a, b) => a.joinSeq - b.joinSeq);
}

export function cartUnits(c: Customer): number {
    let n = 0;
    for (const line of c.cart) n += line.units;
    return n;
}

/** 商品当前的售价系数(临期打折、价格战降价等限时促销;过期的不算)。 */
export function priceFactorOf(state: GameState, itemId: string): number {
    const f = state.priceFactors[itemId];
    const sale = state.market.salePrice;
    return (f && f.untilDay >= state.day ? f.factor : 1) * (sale && sale.untilDay >= state.day ? sale.factor : 1);
}

/** 购物车总价。传入 state 时会计入促销价。 */
export function cartTotal(c: Customer, state?: GameState): number {
    let total = 0;
    for (const line of c.cart) {
        const item = getCatalogItem(line.itemId);
        if (item && item.kind === 'goods') total += Math.round(item.unitPrice * (state ? priceFactorOf(state, item.id) : 1) * line.units);
    }
    return total;
}

/**
 * 挑选顾客想买的东西:只会想买当前等级已解锁的商品。
 * guided(新手引导期间)时,第一件一定是货架上有货的,保证玩家能顺利完成第一笔交易。
 */
const COLD_CATEGORIES = ['饮料', '冷冻品'];

function pickWants(state: GameState, rng: Rng, guided: boolean, coldBoost: boolean): WantLine[] {
    // 顾客只会想买"店里有对应容器可以摆"的商品:没有玻璃展柜时不会有人要糕点,
    // 否则玩家刚升级就被迫承担缺货扣分,又买不起展柜。所有容器都被收走时退回按等级选。
    const unlocked = GOODS.filter((g) => g.unlockLevel <= state.level);
    const stockable = unlocked.filter((g) => state.fixtures.some((f) => f.kind === g.container));
    const pool = (stockable.length > 0 ? stockable : unlocked).map((g) => g.id);
    const r = rng.next();
    const count = Math.min(pool.length, r < 0.5 ? 1 : r < 0.85 ? 2 : 3);

    const chosen: string[] = [];
    if (coldBoost && !guided && rng.next() < 0.6) {
        // 高温天:冷饮和雪糕热销
        const cold = GOODS.filter((g) => g.unlockLevel <= state.level && COLD_CATEGORIES.indexOf(g.category) >= 0).map((g) => g.id);
        if (cold.length > 0) chosen.push(cold[rng.int(0, cold.length - 1)]);
    }
    const inStock = pool.filter((id) => stockedUnits(state, id) > 0);
    if (guided && inStock.length > 0) chosen.push(inStock[rng.int(0, inStock.length - 1)]);
    // 顾客多半是"看货架上有什么买什么":每件想买的东西有 stockedBias 的概率只从现有库存里挑,
    // 其余时候才会想起货架上没有的。否则商品种类一多(每升一级就解锁新的),小店永远摆不齐,满意度只会一路下滑。
    while (chosen.length < count) {
        const fromStock = inStock.length > 0 && rng.next() < CUSTOMER.stockedBias;
        const source = fromStock ? inStock : pool;
        const id = source[rng.int(0, source.length - 1)];
        if (chosen.indexOf(id) < 0) chosen.push(id);
    }
    return chosen.map((id) => ({ itemId: id, units: rng.next() < 0.7 ? 1 : 2 }));
}

function spawnCustomer(state: GameState, rng: Rng, guided: boolean, coldBoost: boolean): void {
    const id = state.nextCustomerId++;
    state.customers.push({
        id,
        kind: kindForCustomer(state, id, guided),
        phase: 'browsing',
        timer: rng.range(CUSTOMER.browseMin, CUSTOMER.browseMax),
        waited: 0,
        wants: pickWants(state, rng, guided, coldBoost),
        cart: [],
        missedItems: [],
        scanned: false,
        joinSeq: 0,
    });
}

/**
 * 推进顾客 dtSec 秒。canSpawn 为 true(店开着)才会来新顾客。
 * 返回这段时间发生的"值得提示玩家"的事件。
 */
export function updateCustomers(
    state: GameState,
    layout: StoreLayout,
    rng: Rng,
    dtSec: number,
    canSpawn: boolean,
    guided: boolean,
    /** 天气带来的影响:客流倍率、是否冷饮热销。 */
    env: { trafficMul: number; coldBoost: boolean } = { trafficMul: 1, coldBoost: false },
): CustomerNotice[] {
    const notices: CustomerNotice[] = [];

    if (canSpawn) {
        state.spawnProgress += (spawnRatePerMinute(state.satisfaction) * env.trafficMul / 60) * dtSec;
        while (state.spawnProgress >= 1) {
            state.spawnProgress -= 1;
            if (state.customers.length < CUSTOMER.maxInStore) spawnCustomer(state, rng, guided, env.coldBoost);
        }
    } else {
        state.spawnProgress = 0;
    }

    // 遍历快照;离开的顾客立刻从 state.customers 移除,这样后面的顾客判断队伍长度时是准确的
    for (const c of state.customers.slice()) {
        c.timer -= dtSec;
        if (c.phase === 'queuing') c.waited += dtSec;

        if (c.phase === 'browsing' && c.timer <= 0) {
            if (!finishBrowsing(state, layout, c, notices)) removeCustomer(state, c.id);
        } else if (c.phase === 'queuing' && c.timer <= 0) {
            returnCart(state, layout, c.cart);
            addSatisfaction(state, SATISFACTION.angryLeave);
            state.today.lost++;
            notices.push({ type: 'angry', customerId: c.id });
            recordExit(state, c, 'angry');
            removeCustomer(state, c.id);
        }
    }
    return notices;
}

function removeCustomer(state: GameState, id: number): void {
    state.customers = state.customers.filter((c) => c.id !== id);
}

/** 逛完了:队伍满了就走;否则按想买的取货,没货的扣满意度;拿到东西就去排队。返回顾客是否留下。 */
function finishBrowsing(state: GameState, layout: StoreLayout, c: Customer, notices: CustomerNotice[]): boolean {
    if (queueOf(state).length >= CUSTOMER.queueCap) {
        addSatisfaction(state, SATISFACTION.queueFull);
        state.today.lost++;
        notices.push({ type: 'queueFull', customerId: c.id });
        recordExit(state, c, 'queueFull');
        return false;
    }

    let penalty = 0;
    const cart: CartLine[] = [];
    for (const want of c.wants) {
        const got = takeFromShelves(state, layout, want.itemId, want.units);
        let gotUnits = 0;
        for (const line of got) {
            cart.push(line);
            gotUnits += line.units;
        }
        if (gotUnits < want.units) {
            state.today.missed[want.itemId] = (state.today.missed[want.itemId] ?? 0) + 1;
            c.missedItems.push(want.itemId);
            penalty += SATISFACTION.missingItem;
        }
    }
    if (penalty < 0) addSatisfaction(state, Math.max(penalty, SATISFACTION.maxMissPenaltyPerCustomer));

    if (cart.length === 0) {
        state.today.lost++;
        notices.push({ type: 'noStock', customerId: c.id });
        recordExit(state, c, 'noStock');
        return false;
    }
    c.cart = cart;
    c.phase = 'queuing';
    c.timer = CUSTOMER.queuePatience;
    c.waited = 0;
    c.joinSeq = state.nextQueueSeq++;
    return true;
}

/** 打烊:所有顾客离开,排队中的被请走(扣一点满意度),购物车里的商品放回货架。 */
export function dismissAllCustomers(state: GameState, layout: StoreLayout): CustomerNotice[] {
    const notices: CustomerNotice[] = [];
    for (const c of state.customers) {
        if (c.phase === 'queuing') {
            returnCart(state, layout, c.cart);
            addSatisfaction(state, SATISFACTION.kickedOut);
            state.today.lost++;
            notices.push({ type: 'kickedOut', customerId: c.id });
            recordExit(state, c, 'kickedOut');
        }
    }
    state.customers = [];
    state.spawnProgress = 0;
    return notices;
}

/** 扫码:只能接待队首的顾客。 */
export function scanCustomer(state: GameState, customerId: number): ScanResult {
    const head = queueOf(state)[0];
    if (!head || head.id !== customerId) return { ok: false, reason: '请先接待排在最前面的顾客' };
    if (head.scanned) return { ok: false, reason: '已经扫过码了,可以收款' };
    head.scanned = true;
    return { ok: true };
}

/** 收款:金币入账,统计销量,按等待时间调整满意度,顾客离开。 */
export function collectPayment(state: GameState, customerId: number): CollectResult {
    const head = queueOf(state)[0];
    if (!head || head.id !== customerId) return { ok: false, reason: '请先接待排在最前面的顾客' };
    if (!head.scanned) return { ok: false, reason: '先扫码再收款' };

    const total = cartTotal(head, state);
    const units = cartUnits(head);
    state.coins += total;
    state.totalServed++;
    state.today.revenue += total;
    state.today.served++;
    for (const line of head.cart) state.today.sold[line.itemId] = (state.today.sold[line.itemId] ?? 0) + line.units;
    const onTime = head.waited <= CUSTOMER.onTimeWaitSec;
    const lowRep = state.satisfaction < CUSTOMER.lowSatThreshold;
    addSatisfaction(state, onTime ? (lowRep ? SATISFACTION.servedOnTimeRebound : SATISFACTION.servedOnTime) : SATISFACTION.servedLate);
    // 调研:问卷客结账后给出问卷并发奖励;暗访客按评分直接调整满意度(都会写进反馈记录)
    recordExit(state, head, 'paid');
    const surveyReward = head.kind === 'survey';
    if (surveyReward) {
        state.coins += SURVEY.rewardCoins;
        addSatisfaction(state, SURVEY.rewardSatisfaction);
    }
    removeCustomer(state, head.id);
    return { ok: true, total, units, surveyReward };
}

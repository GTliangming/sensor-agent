// 一局游戏的会话:持有状态,推进时间,提供"开门/打烊""下单""搬运/上架"等命令。
// 玩家和(后续的)员工都通过命令改状态;命令返回成功或失败原因,界面据此给出反馈。
// 命令只校验游戏规则,不校验"玩家站在哪"——位置判定在 core/world/Actions 里,员工有自己的位置逻辑。
import { EventBus } from './base/EventBus';
import { Rng } from './base/Rng';
import { CustomerNotice, addSatisfaction, collectPayment, dismissAllCustomers, scanCustomer, updateCustomers } from './customers/CustomerSystem';
import { EVENTS, TRASH, XP } from './data/Balance';
import { DELIVERY_GAME_MINUTES, EXPANSIONS, MAX_ORDER_QUANTITY, THEMES, getCatalogItem, unitOrderCost } from './data/Catalog';
import { MAX_LEVEL, nextLevelXp, unlocksAtLevel } from './data/Levels';
import { pickEvent, respondToEvent, timeoutEvent } from './events/EventSystem';
import { WEATHER, WeatherKind, rollWeather } from './events/Weather';
import { containerMismatch, fixtureLabel, maxUnitsFit, unitsForOrder } from './inventory/Inventory';
import { createDayStats } from './state/GameState';
import type { ActiveEvent, Carton, DayReport, EventType, GameState, Order } from './state/GameState';
import { acknowledgeTutorial, advanceTutorial, isTutorialActive } from './tutorial/Tutorial';
import { ClockConfig, DEFAULT_CLOCK_CONFIG, DayPhase, absoluteMinutes, advanceTime, phaseAt } from './time/GameClock';
import { DOOR_INSIDE, distanceToRect } from './world/Interaction';
import { checkPlacement, makeFixture, normalizeRotation, snap } from './world/Placement';
import { EXPANSION_SIZES, Fixture, StoreLayout, buildLayout, obstaclesOf } from './world/StoreLayout';

export type StoreCloseReason = 'player' | 'nightfall' | 'newDay';

export interface GameEvents {
    phaseChanged: { phase: DayPhase; previous: DayPhase };
    dayChanged: { day: number };
    /** reason:谁触发的开/关门。开门只会是 player。 */
    storeOpenChanged: { isOpen: boolean; reason: StoreCloseReason };
    orderPlaced: { order: Order };
    orderArrived: { order: Order };
    customerNotice: CustomerNotice;
    levelUp: { level: number; unlocked: string[] };
    tutorialAdvanced: { step: number };
    /** 一天结束,日报已生成(同时保存在 state.pendingReport,等玩家查看)。 */
    dayReport: { report: DayReport };
    weatherChanged: { weather: WeatherKind; note: string | null };
    eventStarted: { event: ActiveEvent };
    eventResolved: { event: ActiveEvent; message: string; handled: boolean };
}

/** 失败代码:界面需要据此做不同处理(例如金币不足时提供"看广告")。 */
export type FailCode = 'insufficient_coins' | 'invalid' | 'locked' | 'state' | 'wrong_container' | 'full';

/** 成功时可带一句给玩家看的说明(例如"放入 8 件薯片")。 */
export type CommandResult = { ok: true; info?: string } | { ok: false; reason: string; code?: FailCode };

const fail = (reason: string, code?: FailCode): CommandResult => ({ ok: false, reason, code });

export class GameSession {
    readonly events = new EventBus<GameEvents>();
    private readonly rng: Rng;
    /** 布局(设施、扩建、主题)每变一次加 1,表现层据此重建 3D 场景。不存档。 */
    layoutVersion = 0;
    private layoutCache: { expansion: number; fixtures: Fixture[]; layout: StoreLayout } | null = null;

    constructor(
        readonly state: GameState,
        private readonly clock: ClockConfig = DEFAULT_CLOCK_CONFIG,
    ) {
        this.rng = new Rng(state);
        // 读档归一化:夜间不应该是营业状态
        if (this.state.isOpen && this.phase === 'night') this.state.isOpen = false;
    }

    /** 当前布局:由扩建等级和存档里的设施组装。设施数组被整体替换时才会重新组装。 */
    get layout(): StoreLayout {
        const c = this.layoutCache;
        if (c && c.expansion === this.state.expansion && c.fixtures === this.state.fixtures) return c.layout;
        const layout = buildLayout(this.state.expansion, this.state.fixtures);
        this.layoutCache = { expansion: this.state.expansion, fixtures: this.state.fixtures, layout };
        return layout;
    }

    get phase(): DayPhase {
        return phaseAt(this.state.timeOfDay, this.clock);
    }

    /** 当前累计游戏分钟数。 */
    get nowMinute(): number {
        return absoluteMinutes(this.state.day, this.state.timeOfDay, this.clock);
    }

    /** 玩家手里抱着的纸箱(没有则为 null)。 */
    get carried(): Carton | null {
        return this.state.cartons.find((c) => c.location === 'hands') ?? null;
    }

    /** 推进游戏时间 dtSec 秒(现实秒)。 */
    tick(dtSec: number): void {
        if (!(dtSec > 0)) return;
        const prevPhase = this.phase;

        const r = advanceTime(this.state.timeOfDay, dtSec, this.clock);
        this.state.timeOfDay = r.timeOfDay;

        if (r.daysPassed > 0) {
            // 先打烊(顾客离场也计入当天统计),再结算日报,最后进入新的一天
            this.setOpen(false, 'newDay');
            this.finishDay();
            this.state.day += r.daysPassed;
            this.state.today = createDayStats(this.state.day, this.state.satisfaction);
            this.startNewDay();
            this.events.emit('dayChanged', { day: this.state.day });
        }

        const phase = this.phase;
        if (phase !== prevPhase) {
            this.events.emit('phaseChanged', { phase, previous: prevPhase });
            if (phase === 'night') this.setOpen(false, 'nightfall');
        }

        this.processDeliveries();
        const weather = WEATHER[this.state.weather];
        const notices = updateCustomers(this.state, this.layout, this.rng, dtSec, this.state.isOpen, isTutorialActive(this.state), {
            trafficMul: weather.trafficMul,
            coldBoost: weather.coldBoost,
        });
        for (const n of notices) this.events.emit('customerNotice', n);
        const trash = this.state.trash.length;
        if (this.state.isOpen && trash > TRASH.freeCount) {
            addSatisfaction(this.state, -(trash - TRASH.freeCount) * TRASH.penaltyPerPiecePerSec * dtSec);
        }
        this.updateEvents(dtSec);
        this.progressTutorial();
    }

    openStore(): CommandResult {
        if (this.state.isOpen) return fail('已经在营业了', 'state');
        if (this.phase === 'night') return fail('夜间不营业,等天亮再开门吧', 'state');
        this.setOpen(true, 'player');
        return { ok: true };
    }

    closeStore(): CommandResult {
        if (!this.state.isOpen) return fail('已经打烊了', 'state');
        this.setOpen(false, 'player');
        return { ok: true };
    }

    /**
     * 在店长电脑上下单。商品按"批"订购,设备按"件"订购。
     * 下单立即扣金币,订单在 DELIVERY_GAME_MINUTES 游戏分钟后送达。
     */
    placeOrder(itemKey: string, quantity = 1): CommandResult {
        const item = getCatalogItem(itemKey);
        if (!item) return fail('没有这件商品', 'invalid');
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
            return fail(`数量必须在 1~${MAX_ORDER_QUANTITY} 之间`, 'invalid');
        }
        if (this.state.level < item.unlockLevel) return fail(`需要超市达到 ${item.unlockLevel} 级才能采购`, 'locked');

        const cost = this.orderCost(itemKey, quantity);
        if (this.state.coins < cost) return fail(`金币不足,还差 ${cost - this.state.coins}`, 'insufficient_coins');

        const now = this.nowMinute;
        const order: Order = {
            id: this.state.nextOrderId++,
            itemId: itemKey,
            quantity,
            cost,
            status: 'delivering',
            placedAtMinute: now,
            arriveAtMinute: now + Math.round(DELIVERY_GAME_MINUTES * WEATHER[this.state.weather].deliveryMul),
        };
        this.state.coins -= cost;
        this.state.orders.push(order);
        this.events.emit('orderPlaced', { order });
        return { ok: true };
    }

    /** 下单要花多少金币(计入供货商的限时折扣)。 */
    orderCost(itemKey: string, quantity: number): number {
        const item = getCatalogItem(itemKey);
        if (!item) return 0;
        const d = this.state.supplierDiscount;
        const factor = d && d.untilDay >= this.state.day ? d.factor : 1;
        return Math.round(unitOrderCost(item) * quantity * factor);
    }

    /** 让配送中的订单立刻送达(看广告的奖励之一)。 */
    expediteOrder(orderId: number): CommandResult {
        const order = this.state.orders.find((o) => o.id === orderId);
        if (!order) return fail('找不到这张订单', 'invalid');
        if (order.status !== 'delivering') return fail('这张订单已经送达了', 'state');
        order.arriveAtMinute = this.nowMinute;
        this.markArrived(order);
        return { ok: true };
    }

    /** 发放金币奖励(广告等)。 */
    rewardCoins(amount: number): CommandResult {
        if (!Number.isInteger(amount) || amount <= 0) return fail('奖励金额无效', 'invalid');
        this.state.coins += amount;
        return { ok: true };
    }

    // ---------- 搬运与上架 ----------

    /** 搬起卸货区的一个纸箱(手上最多抱一个)。 */
    pickUpCarton(cartonId: number): CommandResult {
        if (this.carried) return fail('手上已经抱着东西了,先放下', 'state');
        const carton = this.state.cartons.find((c) => c.id === cartonId);
        if (!carton || carton.location !== 'door') return fail('找不到这个纸箱', 'invalid');
        carton.location = 'hands';
        return { ok: true };
    }

    /** 把手上的纸箱放回卸货区。 */
    putDownCarton(): CommandResult {
        const carton = this.carried;
        if (!carton) return fail('手上没有东西', 'state');
        carton.location = 'door';
        return { ok: true };
    }

    /**
     * 把手上纸箱里的商品放进指定的货架/冷柜。count 为件数或 'all'。
     * 规则:商品必须放进对应类型的容器(雪糕/生鲜 -> 冷柜,糕点 -> 玻璃展柜,其余 -> 普通货架);容器按格子数限制容量。
     */
    stockContainer(fixtureId: string, count: number | 'all'): CommandResult {
        const carton = this.carried;
        if (!carton) return fail('先搬起一个纸箱', 'state');
        const item = getCatalogItem(carton.itemId);
        if (!item || item.kind !== 'goods') return fail('设备不能放上货架,请收进仓库', 'invalid');
        const fixture = this.layout.fixtures.find((f) => f.id === fixtureId);
        if (!fixture) return fail('找不到这个货架', 'invalid');
        const mismatch = containerMismatch(item, fixture);
        if (mismatch) return fail(mismatch, 'wrong_container');
        const wanted = count === 'all' ? carton.units : count;
        if (!Number.isInteger(wanted) || wanted < 1) return fail('数量无效', 'invalid');

        const contents = this.state.stock[fixture.id];
        const fit = maxUnitsFit(fixture, contents, item);
        if (fit < 1) return fail(`${fixtureLabel(fixture)}已经放满了`, 'full');

        const placed = Math.min(wanted, fit, carton.units);
        const bucket = contents ?? (this.state.stock[fixture.id] = {});
        bucket[item.id] = (bucket[item.id] ?? 0) + placed;
        carton.units -= placed;
        const xpUnits = Math.min(placed, carton.xpLeft);
        carton.xpLeft -= xpUnits;
        this.addXp(xpUnits * XP.perStockedUnit);
        this.finishCartonIfEmpty(carton);
        const limited = placed < Math.min(wanted, carton.units + placed);
        return { ok: true, info: limited ? `${fixtureLabel(fixture)}满了,放进 ${placed} 件${item.name}` : `放入 ${placed} 件${item.name}` };
    }

    /** 从货架/冷柜拿起商品抱在手里(用来调换位置或清理)。手上已有同种商品的纸箱时会合并。 */
    takeFromContainer(fixtureId: string, itemKey: string, count: number | 'all'): CommandResult {
        const fixture = this.layout.fixtures.find((f) => f.id === fixtureId);
        const item = getCatalogItem(itemKey);
        if (!fixture || !item || item.kind !== 'goods') return fail('找不到这件商品', 'invalid');
        const bucket = this.state.stock[fixture.id];
        const have = bucket ? bucket[item.id] ?? 0 : 0;
        if (have < 1) return fail('这里没有这种商品', 'invalid');
        const wanted = count === 'all' ? have : count;
        if (!Number.isInteger(wanted) || wanted < 1) return fail('数量无效', 'invalid');

        const hands = this.carried;
        if (hands && hands.itemId !== item.id) return fail('手上拿着别的东西,先放下', 'state');

        const taken = Math.min(wanted, have);
        if (hands) {
            hands.units += taken;
        } else {
            this.state.cartons.push({ id: this.state.nextCartonId++, orderId: null, itemId: item.id, units: taken, location: 'hands', xpLeft: 0 });
        }
        bucket[item.id] = have - taken;
        if (bucket[item.id] === 0) delete bucket[item.id];
        if (Object.keys(bucket).length === 0) delete this.state.stock[fixture.id];
        return { ok: true, info: `拿起 ${taken} 件${item.name}` };
    }

    /** 把手上的设备纸箱收进仓库(摆放在步骤 8 实现)。 */
    storeEquipment(): CommandResult {
        const carton = this.carried;
        if (!carton) return fail('先搬起一个纸箱', 'state');
        const item = getCatalogItem(carton.itemId);
        if (!item || item.kind !== 'equipment') return fail('商品要放进货架或冷柜', 'invalid');
        this.state.warehouse[item.id] = (this.state.warehouse[item.id] ?? 0) + carton.units;
        const units = carton.units;
        carton.units = 0;
        this.finishCartonIfEmpty(carton);
        return { ok: true, info: `${item.name} × ${units} 已收进仓库` };
    }

    // ---------- 收银 ----------

    /** 收银第一步:扫码。只能接待队首的顾客。 */
    scanCustomer(customerId: number): CommandResult {
        const r = scanCustomer(this.state, customerId);
        return r.ok ? { ok: true } : fail(r.reason, 'state');
    }

    /** 收银第二步:收款,金币入账。 */
    collectPayment(customerId: number): CommandResult {
        const r = collectPayment(this.state, customerId);
        if (!r.ok) return fail(r.reason, 'state');
        this.addXp(XP.perSale + XP.perSoldUnit * r.units);
        if (this.rng.next() < TRASH.chancePerSale) this.spawnTrash();
        return { ok: true, info: `收款 +${r.total} 金币` };
    }

    // ---------- 摆放、扩建、外观、清扫 ----------

    /** 把仓库里的设备摆进店里。位置会吸附到网格,rot 为顺时针旋转次数(每次 90 度)。 */
    placeFixture(equipId: string, x: number, z: number, rot: number): CommandResult {
        const def = getCatalogItem(`equip:${equipId}`);
        if (!def || def.kind !== 'equipment') return fail('没有这种设备', 'invalid');
        if ((this.state.warehouse[equipId] ?? 0) < 1) return fail('仓库里没有这件设备了', 'state');
        const sx = snap(x);
        const sz = snap(z);
        const problem = checkPlacement(this.layout, def, sx, sz, rot);
        if (problem) return fail(problem, 'invalid');

        const fixture = makeFixture(`${equipId}_n${this.state.nextFixtureId++}`, def, sx, sz, normalizeRotation(rot));
        this.state.fixtures = [...this.state.fixtures, fixture]; // 整体替换数组,让布局缓存失效
        this.state.warehouse[equipId] -= 1;
        if (this.state.warehouse[equipId] === 0) delete this.state.warehouse[equipId];
        this.layoutVersion++;
        return { ok: true, info: `已摆放:${def.name}` };
    }

    /** 把店里的设备收回仓库。货架/冷柜里还有商品时不能收。 */
    pickUpFixture(fixtureId: string): CommandResult {
        const f = this.state.fixtures.find((x) => x.id === fixtureId);
        if (!f) return fail('找不到这件设备', 'invalid');
        if (!f.movable || !f.equipId) return fail('这个搬不动', 'state');
        const contents = this.state.stock[f.id];
        if (contents && Object.keys(contents).length > 0) return fail('请先把里面的商品拿走', 'state');
        this.state.fixtures = this.state.fixtures.filter((x) => x.id !== fixtureId);
        this.state.warehouse[f.equipId] = (this.state.warehouse[f.equipId] ?? 0) + 1;
        this.layoutVersion++;
        const def = getCatalogItem(`equip:${f.equipId}`);
        return { ok: true, info: `已收回仓库:${def ? def.name : f.equipId}` };
    }

    /** 花金币扩建店铺到下一级。 */
    expandStore(): CommandResult {
        const next = this.state.expansion + 1;
        if (next >= EXPANSION_SIZES.length) return fail('已经是最大规模了', 'state');
        const rule = EXPANSIONS[next];
        if (this.state.level < rule.unlockLevel) return fail(`需要超市达到 ${rule.unlockLevel} 级才能扩建`, 'locked');
        if (this.state.coins < rule.cost) return fail(`金币不足,还差 ${rule.cost - this.state.coins}`, 'insufficient_coins');
        this.state.coins -= rule.cost;
        this.state.expansion = next;
        this.layoutVersion++;
        return { ok: true, info: `扩建完成:${rule.name}` };
    }

    /** 解锁一个外观主题(调用前界面应先让玩家看完广告)。 */
    unlockTheme(themeId: string): CommandResult {
        const theme = THEMES.find((t) => t.id === themeId);
        if (!theme) return fail('没有这个主题', 'invalid');
        if (this.state.unlockedThemes.indexOf(themeId) >= 0) return fail('已经解锁了', 'state');
        if (this.state.level < theme.unlockLevel) return fail(`需要超市达到 ${theme.unlockLevel} 级`, 'locked');
        this.state.unlockedThemes = [...this.state.unlockedThemes, themeId];
        return { ok: true, info: `解锁了主题:${theme.name}` };
    }

    /** 切换到已解锁的主题。 */
    setTheme(themeId: string): CommandResult {
        if (this.state.unlockedThemes.indexOf(themeId) < 0) return fail('这个主题还没解锁', 'locked');
        if (this.state.theme === themeId) return fail('已经在使用这个主题', 'state');
        this.state.theme = themeId;
        this.layoutVersion++;
        return { ok: true };
    }

    /** 清扫一处垃圾。 */
    sweepTrash(trashId: number): CommandResult {
        if (!this.state.trash.some((t) => t.id === trashId)) return fail('这里没有垃圾了', 'invalid');
        this.state.trash = this.state.trash.filter((t) => t.id !== trashId);
        return { ok: true, info: '打扫干净了' };
    }

    /** 在店内一处空地上留下垃圾(数量有上限,不会落在设施里和门口)。 */
    private spawnTrash(): void {
        if (this.state.trash.length >= TRASH.max) return;
        const layout = this.layout;
        const room = layout.interior;
        const blockers = obstaclesOf(layout);
        for (let i = 0; i < 15; i++) {
            const x = Math.round((room.x + (this.rng.next() - 0.5) * (room.w - 1.5)) * 100) / 100;
            const z = Math.round((room.z + (this.rng.next() - 0.5) * (room.d - 1.5)) * 100) / 100;
            if (blockers.some((r) => distanceToRect(x, z, r) < 0.5)) continue;
            if (Math.hypot(x - DOOR_INSIDE.x, z - DOOR_INSIDE.z) < 0.9) continue;
            this.state.trash = [...this.state.trash, { id: this.state.nextTrashId++, x, z }];
            return;
        }
    }

    // ---------- 天气与突发事件 ----------

    /** 响应一个突发事件的应对选项(optionId 见 describeEvent;"ignore" 等同超时)。 */
    respondEvent(eventId: number, optionId: string): CommandResult {
        const ev = this.state.events.find((e) => e.id === eventId);
        if (!ev) return fail('这个事件已经结束了', 'state');
        const r = respondToEvent(this.state, this.layout, ev, optionId);
        if (!r.ok) return fail(r.reason, r.code === 'insufficient_coins' ? 'insufficient_coins' : 'invalid');
        this.finishEvent(ev, r.outcome.message, r.outcome.handled);
        this.addXp(r.outcome.xp);
        return { ok: true, info: r.outcome.message };
    }

    /** 新的一天:未处理的事件超时、过期的促销失效、换上今天的天气并预报后天的。 */
    private startNewDay(): void {
        for (const ev of this.state.events.slice()) this.resolveTimeout(ev);
        for (const id of Object.keys(this.state.priceFactors)) {
            if (this.state.priceFactors[id].untilDay < this.state.day) delete this.state.priceFactors[id];
        }
        if (this.state.supplierDiscount && this.state.supplierDiscount.untilDay < this.state.day) this.state.supplierDiscount = null;

        this.state.weather = this.state.forecast[0];
        this.state.forecast = [this.state.forecast[1], rollWeather(this.rng, this.state.day + 2)];
        let note: string | null = null;
        if (this.state.weather === 'rain' && !isTutorialActive(this.state)) {
            if (this.state.fixtures.some((f) => f.equipId === 'antislip_mat')) {
                note = '防滑垫起作用了,门口不会打滑';
                this.addXp(5);
            } else {
                this.pushEvent('rain_puddle', null);
            }
        }
        this.events.emit('weatherChanged', { weather: this.state.weather, note });
    }

    private pushEvent(type: EventType, itemId: string | null): void {
        const ev: ActiveEvent = { id: this.state.nextEventId++, type, itemId, remainingSec: EVENTS.durationSec, totalSec: EVENTS.durationSec };
        this.state.events = [...this.state.events, ev];
        this.events.emit('eventStarted', { event: ev });
    }

    private resolveTimeout(ev: ActiveEvent): void {
        const outcome = timeoutEvent(this.state, this.layout, ev);
        this.finishEvent(ev, outcome.message, outcome.handled);
    }

    private finishEvent(ev: ActiveEvent, message: string, handled: boolean): void {
        this.state.events = this.state.events.filter((e) => e.id !== ev.id);
        this.events.emit('eventResolved', { event: ev, message, handled });
    }

    /** 事件倒计时与触发。新手引导期间和夜间不触发新事件。 */
    private updateEvents(dtSec: number): void {
        for (const ev of this.state.events.slice()) {
            ev.remainingSec -= dtSec;
            if (ev.remainingSec <= 0) this.resolveTimeout(ev);
        }
        if (isTutorialActive(this.state) || this.phase === 'night') return;
        this.state.eventCooldown -= dtSec;
        if (this.state.eventCooldown > 0) return;
        this.state.eventCooldown = this.rng.range(EVENTS.cooldownMin, EVENTS.cooldownMax);
        if (this.state.events.length >= EVENTS.maxActive) return;
        const pick = pickEvent(this.state, this.rng);
        if (pick) this.pushEvent(pick.type, pick.itemId);
    }

    // ---------- 经验、日报、新手引导 ----------

    /** 增加经验;够了就升级(可能连升几级),每升一级发一次事件。 */
    addXp(amount: number): void {
        if (!(amount > 0)) return;
        this.state.xp += amount;
        for (;;) {
            const need = nextLevelXp(this.state.level);
            if (this.state.level >= MAX_LEVEL || need === null || this.state.xp < need) break;
            this.state.level++;
            this.events.emit('levelUp', { level: this.state.level, unlocked: unlocksAtLevel(this.state.level) });
        }
    }

    /** 玩家看完日报。 */
    dismissReport(): void {
        this.state.pendingReport = null;
    }

    /** 表现层汇报:玩家已经走动过了(新手引导第一步)。 */
    reportMoved(): void {
        if (this.state.tutorial.moved) return;
        this.state.tutorial.moved = true;
        this.progressTutorial();
    }

    /** 玩家在引导的最后一步点"知道了"。 */
    acknowledgeTutorial(): CommandResult {
        if (!acknowledgeTutorial(this.state)) return fail('现在不需要确认', 'state');
        this.events.emit('tutorialAdvanced', { step: this.state.tutorial.step });
        return { ok: true };
    }

    private progressTutorial(): void {
        for (const step of advanceTutorial(this.state)) this.events.emit('tutorialAdvanced', { step: step + 1 });
    }

    /** 一天结束:汇总当天统计,生成等待玩家查看的日报。 */
    private finishDay(): void {
        const t = this.state.today;
        let soldUnits = 0;
        let bestSeller: string | null = null;
        let bestUnits = 0;
        for (const id of Object.keys(t.sold)) {
            soldUnits += t.sold[id];
            if (t.sold[id] > bestUnits) {
                bestUnits = t.sold[id];
                bestSeller = id;
            }
        }
        const missed = Object.keys(t.missed)
            .sort((a, b) => t.missed[b] - t.missed[a])
            .slice(0, 3);
        const report: DayReport = {
            day: t.day,
            revenue: t.revenue,
            served: t.served,
            lost: t.lost,
            soldUnits,
            bestSeller,
            missed,
            satisfactionStart: t.satisfactionStart,
            satisfactionEnd: this.state.satisfaction,
        };
        this.state.pendingReport = report;
        this.events.emit('dayReport', { report });
    }

    private processDeliveries(): void {
        if (WEATHER[this.state.weather].trucksStopped) return; // 暴雪大雾货车停运,订单等天气过去再送
        const now = this.nowMinute;
        for (const order of this.state.orders) {
            if (order.status === 'delivering' && order.arriveAtMinute <= now) this.markArrived(order);
        }
    }

    /** 订单送达:在卸货区生成一个装着全部货物的纸箱。 */
    private markArrived(order: Order): void {
        order.status = 'arrived';
        this.state.cartons.push({
            id: this.state.nextCartonId++,
            orderId: order.id,
            itemId: order.itemId,
            units: unitsForOrder(order),
            location: 'door',
            xpLeft: getCatalogItem(order.itemId)?.kind === 'goods' ? unitsForOrder(order) : 0,
        });
        this.events.emit('orderArrived', { order });
    }

    /** 纸箱空了就丢掉;如果它来自订单,这张订单也就处理完了。 */
    private finishCartonIfEmpty(carton: Carton): void {
        if (carton.units > 0) return;
        this.state.cartons = this.state.cartons.filter((c) => c.id !== carton.id);
        if (carton.orderId !== null) this.state.orders = this.state.orders.filter((o) => o.id !== carton.orderId);
    }

    /** 状态真正变化时才改值并发事件。 */
    private setOpen(isOpen: boolean, reason: StoreCloseReason): void {
        if (this.state.isOpen === isOpen) return;
        this.state.isOpen = isOpen;
        if (!isOpen) {
            for (const n of dismissAllCustomers(this.state, this.layout)) this.events.emit('customerNotice', n);
        }
        this.events.emit('storeOpenChanged', { isOpen, reason });
    }
}

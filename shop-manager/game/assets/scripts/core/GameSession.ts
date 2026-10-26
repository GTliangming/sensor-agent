// 一局游戏的会话:持有状态,推进时间,提供"开门/打烊""下单""加急"等命令。
// 玩家和(后续的)员工都通过命令改状态;命令返回成功或失败原因,界面据此给出反馈。
import { EventBus } from './base/EventBus';
import { DELIVERY_GAME_MINUTES, MAX_ORDER_QUANTITY, getCatalogItem, unitOrderCost } from './data/Catalog';
import type { GameState, Order } from './state/GameState';
import { ClockConfig, DEFAULT_CLOCK_CONFIG, DayPhase, absoluteMinutes, advanceTime, phaseAt } from './time/GameClock';

export type StoreCloseReason = 'player' | 'nightfall' | 'newDay';

export interface GameEvents {
    phaseChanged: { phase: DayPhase; previous: DayPhase };
    dayChanged: { day: number };
    /** reason:谁触发的开/关门。开门只会是 player。 */
    storeOpenChanged: { isOpen: boolean; reason: StoreCloseReason };
    orderPlaced: { order: Order };
    orderArrived: { order: Order };
}

/** 失败代码:界面需要据此做不同处理(例如金币不足时提供"看广告")。 */
export type FailCode = 'insufficient_coins' | 'invalid' | 'locked' | 'state';

export type CommandResult = { ok: true } | { ok: false; reason: string; code?: FailCode };

const fail = (reason: string, code?: FailCode): CommandResult => ({ ok: false, reason, code });

export class GameSession {
    readonly events = new EventBus<GameEvents>();

    constructor(
        readonly state: GameState,
        private readonly clock: ClockConfig = DEFAULT_CLOCK_CONFIG,
    ) {
        // 读档归一化:夜间不应该是营业状态
        if (this.state.isOpen && this.phase === 'night') this.state.isOpen = false;
    }

    get phase(): DayPhase {
        return phaseAt(this.state.timeOfDay, this.clock);
    }

    /** 当前累计游戏分钟数。 */
    get nowMinute(): number {
        return absoluteMinutes(this.state.day, this.state.timeOfDay, this.clock);
    }

    /** 推进游戏时间 dtSec 秒(现实秒)。 */
    tick(dtSec: number): void {
        if (!(dtSec > 0)) return;
        const prevPhase = this.phase;

        const r = advanceTime(this.state.timeOfDay, dtSec, this.clock);
        this.state.timeOfDay = r.timeOfDay;

        if (r.daysPassed > 0) {
            this.state.day += r.daysPassed;
            // 新的一天默认是打烊状态,需要玩家手动开门
            this.setOpen(false, 'newDay');
            this.events.emit('dayChanged', { day: this.state.day });
        }

        const phase = this.phase;
        if (phase !== prevPhase) {
            this.events.emit('phaseChanged', { phase, previous: prevPhase });
            if (phase === 'night') this.setOpen(false, 'nightfall');
        }

        this.processDeliveries();
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

        const cost = unitOrderCost(item) * quantity;
        if (this.state.coins < cost) return fail(`金币不足,还差 ${cost - this.state.coins}`, 'insufficient_coins');

        const now = this.nowMinute;
        const order: Order = {
            id: this.state.nextOrderId++,
            itemId: itemKey,
            quantity,
            cost,
            status: 'delivering',
            placedAtMinute: now,
            arriveAtMinute: now + DELIVERY_GAME_MINUTES,
        };
        this.state.coins -= cost;
        this.state.orders.push(order);
        this.events.emit('orderPlaced', { order });
        return { ok: true };
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

    private processDeliveries(): void {
        const now = this.nowMinute;
        for (const order of this.state.orders) {
            if (order.status === 'delivering' && order.arriveAtMinute <= now) this.markArrived(order);
        }
    }

    private markArrived(order: Order): void {
        order.status = 'arrived';
        this.events.emit('orderArrived', { order });
    }

    /** 状态真正变化时才改值并发事件。 */
    private setOpen(isOpen: boolean, reason: StoreCloseReason): void {
        if (this.state.isOpen === isOpen) return;
        this.state.isOpen = isOpen;
        this.events.emit('storeOpenChanged', { isOpen, reason });
    }
}

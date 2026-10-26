declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { GameSession } from '../../assets/scripts/core/GameSession';
import { DELIVERY_GAME_MINUTES, EQUIPMENT, GOODS, MAX_ORDER_QUANTITY, getCatalogItem, unitOrderCost } from '../../assets/scripts/core/data/Catalog';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG, describeAbsoluteMinute } from '../../assets/scripts/core/time/GameClock';

const CFG = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };
const SEC_PER_GAME_MINUTE = 240 / 1080; // 一天 18 小时 = 1080 游戏分钟

function newSession(mut?: (s: ReturnType<typeof createInitialState>) => void): GameSession {
    const s = createInitialState();
    if (mut) mut(s);
    return new GameSession(s, CFG);
}

test('目录数据:id 唯一、价格为正、商品售价高于进货价', () => {
    const keys = new Set<string>();
    for (const g of GOODS) {
        assert.ok(!keys.has(g.id), `重复 id ${g.id}`);
        keys.add(g.id);
        assert.ok(g.unitPrice > g.unitCost && g.unitCost > 0 && g.batchSize > 0 && g.slots > 0, g.id);
    }
    for (const e of EQUIPMENT) {
        assert.ok(e.price > 0 && e.unlockLevel >= 1, e.id);
        assert.ok(getCatalogItem(`equip:${e.id}`), e.id);
    }
});

test('下单:扣金币、生成配送中订单、发出事件', () => {
    const g = newSession();
    const events: number[] = [];
    g.events.on('orderPlaced', (e) => events.push(e.order.id));
    const cost = unitOrderCost(getCatalogItem('chips')!) * 2; // 3 * 12 * 2
    assert.deepEqual(g.placeOrder('chips', 2), { ok: true });
    assert.equal(g.state.coins, 500 - cost);
    assert.equal(g.state.orders.length, 1);
    const o = g.state.orders[0];
    assert.equal(o.status, 'delivering');
    assert.equal(o.cost, cost);
    assert.equal(o.arriveAtMinute - o.placedAtMinute, DELIVERY_GAME_MINUTES);
    assert.equal(g.state.nextOrderId, 2);
    assert.deepEqual(events, [1]);
});

test('金币不足:不扣钱、不生成订单,并返回 insufficient_coins 代码和差额', () => {
    const g = newSession((s) => (s.coins = 10));
    const r: any = g.placeOrder('chips', 1);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'insufficient_coins');
    assert.ok(r.reason.includes(String(36 - 10)), r.reason);
    assert.equal(g.state.coins, 10);
    assert.equal(g.state.orders.length, 0);
});

test('等级不足、未知商品、非法数量都被拒绝且不改状态', () => {
    const g = newSession();
    assert.equal((g.placeOrder('cake', 1) as any).code, 'locked'); // 蛋糕 2 级
    assert.equal((g.placeOrder('nope', 1) as any).code, 'invalid');
    for (const q of [0, -1, 1.5, MAX_ORDER_QUANTITY + 1, NaN]) {
        assert.equal((g.placeOrder('chips', q) as any).code, 'invalid', `q=${q}`);
    }
    assert.equal(g.state.coins, 500);
    assert.equal(g.state.orders.length, 0);
});

test('设备与商品 id 重名时互不干扰(shelf 商品容器 vs equip:shelf 设备)', () => {
    const g = newSession();
    assert.deepEqual(g.placeOrder('equip:shelf', 1), { ok: true });
    assert.equal(g.state.coins, 500 - 300);
    assert.equal((g.placeOrder('shelf', 1) as any).code, 'invalid');
});

test('订单随游戏时间送达:未到时间不动,到点变 arrived 并发事件', () => {
    const g = newSession();
    const arrived: number[] = [];
    g.events.on('orderArrived', (e) => arrived.push(e.order.id));
    g.placeOrder('water', 1);
    g.tick((DELIVERY_GAME_MINUTES - 5) * SEC_PER_GAME_MINUTE);
    assert.equal(g.state.orders[0].status, 'delivering');
    assert.deepEqual(arrived, []);
    g.tick(6 * SEC_PER_GAME_MINUTE);
    assert.equal(g.state.orders[0].status, 'arrived');
    assert.deepEqual(arrived, [1]);
    g.tick(100); // 已送达的订单不会重复触发
    assert.deepEqual(arrived, [1]);
});

test('订单送达时间可以跨天', () => {
    const g = newSession((s) => (s.timeOfDay = (23.5 - 6) / 18)); // 23:30 下单
    g.placeOrder('water', 1);
    const eta = describeAbsoluteMinute(g.state.orders[0].arriveAtMinute, CFG);
    assert.equal(eta.day, 2);
    g.tick(60 * SEC_PER_GAME_MINUTE); // 过了午夜,新的一天 06:30 左右,仍未送达(到次日 07:00)
    assert.equal(g.state.day, 2);
    assert.equal(g.state.orders[0].status, 'delivering');
    g.tick(60 * SEC_PER_GAME_MINUTE);
    assert.equal(g.state.orders[0].status, 'arrived');
});

test('加急:配送中订单立刻送达;已送达或不存在的订单被拒绝', () => {
    const g = newSession();
    g.placeOrder('water', 1);
    assert.deepEqual(g.expediteOrder(1), { ok: true });
    assert.equal(g.state.orders[0].status, 'arrived');
    assert.equal((g.expediteOrder(1) as any).code, 'state');
    assert.equal((g.expediteOrder(99) as any).code, 'invalid');
});

test('奖励金币:正整数才生效', () => {
    const g = newSession();
    assert.deepEqual(g.rewardCoins(200), { ok: true });
    assert.equal(g.state.coins, 700);
    assert.equal(g.rewardCoins(0).ok, false);
    assert.equal(g.rewardCoins(-5).ok, false);
    assert.equal(g.rewardCoins(1.5).ok, false);
    assert.equal(g.state.coins, 700);
});

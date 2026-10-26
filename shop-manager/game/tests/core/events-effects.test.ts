declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { EVENTS } from '../../assets/scripts/core/data/Balance';
import { describeEvent } from '../../assets/scripts/core/events/EventSystem';
import { GameSession } from '../../assets/scripts/core/GameSession';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import type { EventType } from '../../assets/scripts/core/state/GameState';
import { addShopper, newSession } from './sim-helpers';

function addEvent(g: GameSession, type: EventType, itemId: string | null = null): number {
    const id = g.state.nextEventId++;
    g.state.events.push({ id, type, itemId, remainingSec: EVENTS.durationSec, totalSec: EVENTS.durationSec });
    g.state.eventCooldown = 1e9;
    return id;
}

/** 超过保护期、有等级的会话。 */
function seasoned(seed = 1): GameSession {
    const g = newSession(seed);
    g.state.day = 6;
    g.state.level = 3;
    g.state.timeOfDay = 0.05;
    return g;
}

test('每种事件都有标题、说明和至少两个选项(含"不理会"或"算了")', () => {
    const types: EventType[] = ['rain_puddle', 'heat_fridge', 'wind_sign', 'supplier_discount', 'expiring', 'blackout'];
    for (const t of types) {
        const d = describeEvent({ id: 1, type: t, itemId: 'icecream', remainingSec: 1, totalSec: 1 });
        assert.ok(d.title.length > 0 && d.body.length > 0, t);
        assert.ok(d.options.length >= 2, t);
        assert.ok(d.options.every((o) => o.cost >= 0 && o.label.length > 0), t);
    }
});

test('妥善处理:扣费、奖励满意度和经验、事件消失;金币不足则不处理且事件还在', () => {
    const g = seasoned();
    g.state.satisfaction = 50;
    const id = addEvent(g, 'heat_fridge');
    g.state.coins = EVENTS.heat.maintainCost - 1;
    const poor: any = g.respondEvent(id, 'maintain');
    assert.equal(poor.code, 'insufficient_coins');
    assert.equal(g.state.events.length, 1);

    g.state.coins = 500;
    const resolved: any[] = [];
    g.events.on('eventResolved', (e) => resolved.push(e));
    assert.equal(g.respondEvent(id, 'maintain').ok, true);
    assert.equal(g.state.coins, 500 - EVENTS.heat.maintainCost);
    assert.equal(g.state.satisfaction, 50 + EVENTS.handledSatisfaction);
    assert.equal(g.state.xp, EVENTS.handledXp);
    assert.equal(g.state.events.length, 0);
    assert.equal(resolved[0].handled, true);
    assert.equal((g.respondEvent(id, 'maintain') as any).code, 'state'); // 事件已结束
    assert.equal((g.respondEvent(addEvent(g, 'heat_fridge'), 'nope') as any).code, 'invalid');
});

test('冷柜过热/停电超时:冷柜里的货被损坏,有上限;货架(非冷柜)上的货不受影响', () => {
    const g = seasoned();
    g.state.stock['fridge_1'] = { icecream: 18 };
    g.state.stock['shelf_1'] = { chips: 24 };
    g.state.satisfaction = 60;
    addEvent(g, 'heat_fridge');
    g.tick(EVENTS.durationSec + 1);
    assert.equal(g.state.stock['fridge_1'].icecream, 18 - EVENTS.heat.lossUnits);
    assert.equal(g.state.stock['shelf_1'].chips, 24);
    assert.equal(g.state.satisfaction, 60 + EVENTS.heat.penalty);

    addEvent(g, 'blackout');
    g.tick(EVENTS.durationSec + 1);
    assert.equal(g.state.stock['fridge_1'].icecream, 18 - EVENTS.heat.lossUnits - EVENTS.blackout.lossUnits);

    // 冷柜里货少于上限时,最多损失现有的
    const h = seasoned();
    h.state.stock['fridge_1'] = { icecream: 2 };
    const id = addEvent(h, 'blackout');
    assert.equal(h.respondEvent(id, 'ignore').ok, true);
    assert.equal(h.state.stock['fridge_1'], undefined);
});

test('招牌被吹落:花钱重买,最多 150 且不会花到负数', () => {
    const g = seasoned();
    g.state.coins = 1000;
    addEvent(g, 'wind_sign');
    g.tick(EVENTS.durationSec + 1);
    assert.equal(g.state.coins, 1000 - EVENTS.wind.replaceCost);
    g.state.coins = 40;
    addEvent(g, 'wind_sign');
    g.tick(EVENTS.durationSec + 1);
    assert.equal(g.state.coins, 0);
});

test('积水事件:清理花钱;超时差评。保护期内惩罚减半', () => {
    const g = seasoned();
    const id = addEvent(g, 'rain_puddle');
    const coins = g.state.coins;
    g.respondEvent(id, 'clean');
    assert.equal(g.state.coins, coins - EVENTS.rain.cleanCost);

    const late = seasoned();
    addEvent(late, 'rain_puddle');
    late.tick(EVENTS.durationSec + 1);
    assert.equal(late.state.satisfaction, 60 + EVENTS.rain.timeoutPenalty);

    const early = seasoned();
    early.state.day = 2;
    addEvent(early, 'rain_puddle');
    early.tick(EVENTS.durationSec + 1);
    assert.equal(early.state.satisfaction, 60 + EVENTS.rain.protectedPenalty);
});

test('供货商打折:接受后当天进货按折扣价,第二天失效;不接受没有惩罚', () => {
    const g = seasoned();
    const full = g.orderCost('chips', 2);
    const id = addEvent(g, 'supplier_discount');
    g.respondEvent(id, 'accept');
    const discounted = g.orderCost('chips', 2);
    assert.equal(discounted, Math.round(full * EVENTS.supplier.factor));
    const before = g.state.coins;
    g.placeOrder('chips', 2);
    assert.equal(before - g.state.coins, discounted);
    g.state.timeOfDay = 0.99;
    g.tick(240 * 0.02);
    assert.equal(g.orderCost('chips', 2), full);
    assert.equal(g.state.supplierDiscount, null);

    const h = seasoned();
    h.state.satisfaction = 60;
    addEvent(h, 'supplier_discount');
    h.tick(EVENTS.durationSec + 1);
    assert.equal(h.state.satisfaction, 60);
    assert.equal(h.state.supplierDiscount, null);
});

test('商品快过期:打折促销后收银按促销价;不处理则扔掉一半(最多 12 件);促销第二天失效', () => {
    const g = seasoned();
    g.state.stock['fridge_1'] = { icecream: 10 };
    const id = addEvent(g, 'expiring', 'icecream');
    g.respondEvent(id, 'promo');
    addShopper(g, 'icecream', 1);
    g.tick(0.2);
    const c = g.state.customers[0];
    g.scanCustomer(c.id);
    const before = g.state.coins;
    g.collectPayment(c.id);
    assert.equal(g.state.coins - before, Math.round(6 * EVENTS.expiring.promoFactor)); // 雪糕原价 6
    g.state.timeOfDay = 0.99;
    g.tick(240 * 0.02);
    assert.deepEqual(g.state.priceFactors, {});

    const h = seasoned();
    h.state.stock['fridge_1'] = { icecream: 9 };
    addEvent(h, 'expiring', 'icecream');
    h.tick(EVENTS.durationSec + 1);
    assert.equal(h.state.stock['fridge_1'].icecream, 9 - 5); // 扔掉 ceil(9 × 50%) = 5
    const big = seasoned();
    big.state.stock['fridge_1'] = { icecream: 18 };
    big.state.stock['shelf_1'] = { chips: 1 };
    big.state.fixtures = big.state.fixtures; // 无变化,占位
    addEvent(big, 'expiring', 'icecream');
    big.tick(EVENTS.durationSec + 1);
    assert.equal(big.state.stock['fridge_1'].icecream, 18 - 9); // ceil(18 × 50%) = 9 ≤ 12
});

test('事件有倒计时;跨天时还没处理的事件按超时结算', () => {
    const g = seasoned();
    const id = addEvent(g, 'wind_sign');
    g.tick(10);
    assert.ok(Math.abs(g.state.events[0].remainingSec - (EVENTS.durationSec - 10)) < 1e-9);
    assert.equal(g.state.events[0].id, id);
    const coins = g.state.coins;
    g.state.forecast = ['clear', 'clear']; // 避免新一天恰好下雨又触发积水事件
    g.state.timeOfDay = 0.99;
    g.tick(240 * 0.02);
    assert.equal(g.state.events.length, 0);
    assert.equal(g.state.coins, coins - EVENTS.wind.replaceCost);
});

test('存档 v6:天气、预报、事件、促销往返一致;v5 迁移;非法数据判为 corrupt', () => {
    const g = seasoned(7);
    g.state.weather = 'hot';
    g.state.forecast = ['rain', 'wind'];
    addEvent(g, 'expiring', 'icecream');
    g.state.priceFactors = { icecream: { factor: 0.6, untilDay: 6 } };
    g.state.supplierDiscount = { factor: 0.8, untilDay: 6 };
    const r: any = parseSave(serializeState(g.state));
    assert.equal(r.kind, 'ok');
    assert.deepEqual(r.state, g.state);

    const v5 = JSON.parse(serializeState(g.state));
    v5.schema_version = 5;
    for (const k of ['weather', 'forecast', 'events', 'nextEventId', 'eventCooldown', 'priceFactors', 'supplierDiscount']) delete v5.state[k];
    const m: any = parseSave(JSON.stringify(v5));
    assert.equal(m.kind, 'ok');
    assert.equal(m.state.weather, 'clear');
    assert.deepEqual(m.state.events, []);

    const bad = (mut: (o: any) => void) => {
        const o = JSON.parse(serializeState(g.state));
        mut(o);
        return parseSave(JSON.stringify(o)).kind;
    };
    assert.equal(bad((o) => (o.state.weather = 'tornado')), 'corrupt');
    assert.equal(bad((o) => (o.state.forecast = ['clear'])), 'corrupt');
    assert.equal(bad((o) => (o.state.events[0].type = 'ufo')), 'corrupt');
    assert.equal(bad((o) => (o.state.priceFactors.icecream.factor = 0)), 'corrupt');
    assert.equal(bad((o) => (o.state.supplierDiscount = { factor: 1 })), 'corrupt');
});

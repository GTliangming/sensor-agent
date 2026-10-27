declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { Rng } from '../../assets/scripts/core/base/Rng';
import { priceFactorOf } from '../../assets/scripts/core/customers/CustomerSystem';
import { EVENTS } from '../../assets/scripts/core/data/Balance';
import { describeEvent, inspectionProblems, pickEvent } from '../../assets/scripts/core/events/EventSystem';
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

/** 超过保护期、等级够高的会话。 */
function seasoned(seed = 1): GameSession {
    const g = newSession(seed);
    g.state.day = 6;
    g.state.level = 4;
    g.state.timeOfDay = 0.05;
    return g;
}

function withExtinguisher(g: GameSession): void {
    g.state.warehouse['extinguisher'] = 1;
    assert.equal(g.placeFixture('extinguisher', 0, 3.4, 0).ok, true);
}

test('新增事件都有标题、说明和至少两个选项;价格战是三选一', () => {
    const types: EventType[] = ['fire', 'inspection', 'price_war', 'competitor_open', 'competitor_close', 'supplier_stolen'];
    for (const t of types) {
        const d = describeEvent({ id: 1, type: t, itemId: null, remainingSec: 1, totalSec: 1 });
        assert.ok(d.title.length > 0 && d.body.length > 0, t);
        assert.ok(d.options.length >= 2, t);
        assert.ok(d.options.every((o) => o.label.length > 0 && o.cost >= 0), t);
    }
    const war = describeEvent({ id: 1, type: 'price_war', itemId: null, remainingSec: 1, totalSec: 1 });
    assert.deepEqual(war.options.map((o) => o.id), ['follow', 'loyal', 'poster']);
});

test('火情:没有灭火器不能灭火(事件还在);摆了灭火器可以灭,算妥善处理', () => {
    const g = seasoned();
    const id = addEvent(g, 'fire');
    const r: any = g.respondEvent(id, 'extinguish');
    assert.equal(r.ok, false);
    assert.equal(g.state.events.length, 1);

    withExtinguisher(g);
    g.state.satisfaction = 50;
    assert.equal(g.respondEvent(id, 'extinguish').ok, true);
    assert.equal(g.state.events.length, 0);
    assert.equal(g.state.satisfaction, 50 + EVENTS.handledSatisfaction);
    assert.equal(g.state.xp, EVENTS.handledXp);
});

test('火情疏散:顾客全部离店、购物车放回货架,损失比超时小且有上限', () => {
    const g = seasoned();
    g.state.stock['shelf_1'] = { chips: 24 };
    g.state.coins = 500;
    g.state.satisfaction = 50;
    addShopper(g, 'chips', 1);
    const id = addEvent(g, 'fire');
    const r: any = g.respondEvent(id, 'evacuate');
    assert.equal(r.ok, true);
    assert.equal(g.state.customers.length, 0);
    assert.equal(g.state.coins, 500 - EVENTS.fire.evacuateCoins);
    assert.equal(g.state.stock['shelf_1'].chips, 24 - EVENTS.fire.evacuateUnits);
    assert.equal(g.state.satisfaction, 50 + EVENTS.fire.evacuatePenalty);
    assert.equal(g.state.xp, 0); // 没有妥善处理,没有经验
});

test('火情超时:损失金币和商品都有上限,金币不够只扣到 0', () => {
    const g = seasoned();
    g.state.stock['shelf_1'] = { chips: 24 };
    g.state.stock['fridge_1'] = { icecream: 18 };
    g.state.coins = 500;
    addEvent(g, 'fire');
    g.tick(EVENTS.durationSec + 1);
    assert.equal(g.state.coins, 500 - EVENTS.fire.timeoutCoins);
    const left = g.state.stock['shelf_1'].chips + g.state.stock['fridge_1'].icecream;
    assert.equal(left, 42 - EVENTS.fire.timeoutUnits);
    assert.ok(EVENTS.fire.timeoutUnits <= EVENTS.lossCapUnits && EVENTS.fire.timeoutCoins <= EVENTS.lossCapCoins);

    const poor = seasoned();
    poor.state.coins = 30;
    addEvent(poor, 'fire');
    poor.tick(EVENTS.durationSec + 1);
    assert.equal(poor.state.coins, 0);
});

test('消防抽查:没有灭火器不合格要罚款;摆了灭火器合格有奖励;拒绝检查也罚款', () => {
    const bad = seasoned();
    bad.state.coins = 300;
    assert.deepEqual(inspectionProblems(bad.state, bad.layout), ['没有摆灭火器']);
    const r: any = bad.respondEvent(addEvent(bad, 'inspection'), 'cooperate');
    assert.equal(r.ok, true);
    assert.equal(bad.state.coins, 300 - EVENTS.inspection.fine);
    assert.equal(bad.state.xp, 0);

    const good = seasoned();
    withExtinguisher(good);
    good.state.coins = 300;
    assert.deepEqual(inspectionProblems(good.state, good.layout), []);
    assert.equal(good.respondEvent(addEvent(good, 'inspection'), 'cooperate').ok, true);
    assert.equal(good.state.coins, 300 + EVENTS.inspection.rewardCoins);
    assert.equal(good.state.xp, EVENTS.handledXp);

    const refuse = seasoned();
    withExtinguisher(refuse);
    refuse.state.coins = 300;
    refuse.respondEvent(addEvent(refuse, 'inspection'), 'ignore');
    assert.equal(refuse.state.coins, 300 - EVENTS.inspection.fine);

    const poor = seasoned();
    poor.state.coins = 20;
    addEvent(poor, 'inspection');
    poor.tick(EVENTS.durationSec + 1);
    assert.equal(poor.state.coins, 0);
});

test('消防抽查:通道被堵住算不合格', () => {
    const g = seasoned();
    withExtinguisher(g);
    const room = g.layout.interior;
    // 一个铺满整个店内的大货架把所有设施正面都堵死
    g.state.fixtures = [
        ...g.state.fixtures,
        { id: 'block_1', kind: 'shelf', x: room.x, z: room.z, w: room.w, d: room.d, height: 1, front: { x: 0, z: 1 } },
    ];
    const problems = inspectionProblems(g.state, g.layout);
    assert.equal(problems.length, 1);
    assert.ok(problems[0].startsWith('通道不畅'));
});

test('价格战三选一:跟着降价 / 口碑留客 / 海报各有不同结果', () => {
    // 跟着降价:全场售价打折,客流不受影响
    const a = seasoned();
    a.respondEvent(addEvent(a, 'price_war'), 'follow');
    assert.equal(priceFactorOf(a.state, 'chips'), EVENTS.priceWar.followPriceFactor);
    assert.equal(a.state.market.traffic, null);

    // 口碑留客:满意度够高没有损失,不够则客流下降
    const b = seasoned();
    b.state.satisfaction = EVENTS.priceWar.loyalMinSatisfaction;
    b.respondEvent(addEvent(b, 'price_war'), 'loyal');
    assert.equal(b.state.market.traffic, null);
    const c = seasoned();
    c.state.satisfaction = EVENTS.priceWar.loyalMinSatisfaction - 1;
    c.respondEvent(addEvent(c, 'price_war'), 'loyal');
    assert.equal(c.state.market.traffic!.factor, EVENTS.priceWar.loyalFailTraffic);

    // 海报:花钱,客流小幅下降
    const d = seasoned();
    d.state.coins = 200;
    d.respondEvent(addEvent(d, 'price_war'), 'poster');
    assert.equal(d.state.coins, 200 - EVENTS.priceWar.posterCost);
    assert.equal(d.state.market.traffic!.factor, EVENTS.priceWar.posterTraffic);
    d.state.coins = 0;
    const poor: any = d.respondEvent(addEvent(d, 'price_war'), 'poster');
    assert.equal(poor.code, 'insufficient_coins');

    // 超时不选:客流损失最大
    const e = seasoned();
    addEvent(e, 'price_war');
    e.tick(EVENTS.durationSec + 1);
    assert.equal(e.state.market.traffic!.factor, EVENTS.priceWar.timeoutTraffic);
    assert.ok(EVENTS.priceWar.timeoutTraffic < EVENTS.priceWar.loyalFailTraffic);
    assert.ok(EVENTS.priceWar.loyalFailTraffic < EVENTS.priceWar.posterTraffic);
});

test('竞品与供货商:影响客流和进货价,持续天数到了自动失效', () => {
    const open = seasoned();
    addEvent(open, 'competitor_open');
    open.tick(EVENTS.durationSec + 1);
    assert.equal(open.state.market.traffic!.factor, EVENTS.competitor.openTraffic);
    assert.equal(open.state.market.traffic!.untilDay, open.state.day + EVENTS.competitor.openDays - 1);

    const close = seasoned();
    close.respondEvent(addEvent(close, 'competitor_close'), 'welcome');
    assert.equal(close.state.market.traffic!.factor, EVENTS.competitor.closeTraffic);

    const base = seasoned();
    const normal = base.orderCost('chips', 2);
    const stolen = seasoned();
    addEvent(stolen, 'supplier_stolen');
    stolen.tick(EVENTS.durationSec + 1);
    assert.equal(stolen.orderCost('chips', 2), Math.round(normal * EVENTS.supplierStolen.costFactor));
    const negotiated = seasoned();
    negotiated.state.coins = 500;
    negotiated.respondEvent(addEvent(negotiated, 'supplier_stolen'), 'negotiate');
    assert.equal(negotiated.orderCost('chips', 2), normal);
    assert.equal(negotiated.state.coins, 500 - EVENTS.supplierStolen.negotiateCost);

    // 过了持续天数,影响消失
    open.state.timeOfDay = 0.99;
    for (let i = 0; i < EVENTS.competitor.openDays; i++) {
        open.state.timeOfDay = 0.99;
        open.tick(240 * 0.02);
    }
    assert.equal(open.state.market.traffic, null);
});

test('竞争事件让客流下降:受影响的店里来的顾客更少', () => {
    const count = (factor: number) => {
        const g = newSession(21);
        g.state.satisfaction = 100;
        g.state.timeOfDay = 0.05;
        g.state.eventCooldown = 1e9;
        g.state.market.traffic = { factor, untilDay: g.state.day };
        g.openStore();
        for (let i = 0; i < 240; i++) g.tick(0.5);
        return g.state.nextCustomerId - 1;
    };
    assert.ok(count(0.5) < count(1));
});

test('新事件不会出现在新手保护期和低等级;满足条件后才会随机出现', () => {
    const NEW: EventType[] = ['fire', 'inspection', 'price_war', 'competitor_open', 'competitor_close', 'supplier_stolen'];
    const seen = (day: number, level: number) => {
        const types = new Set<string>();
        const g = newSession(1);
        g.state.day = day;
        g.state.level = level;
        const rng = new Rng({ rngState: 77 });
        for (let i = 0; i < 400; i++) {
            const p = pickEvent(g.state, rng);
            if (p) types.add(p.type);
        }
        return types;
    };
    for (const t of seen(2, 5)) assert.ok(NEW.indexOf(t as EventType) < 0, `保护期出现了 ${t}`);
    const lv1 = seen(8, 1);
    for (const t of NEW) assert.equal(lv1.has(t), false, `1 级出现了 ${t}`);
    const lv2 = seen(8, 2);
    assert.ok(lv2.has('fire') && lv2.has('inspection'));
    assert.equal(lv2.has('price_war'), false);
    const lv3 = seen(8, 3);
    for (const t of NEW) assert.ok(lv3.has(t), `3 级没出现 ${t}`);
});

test('存档 v7:市场影响往返不丢;v6 旧存档迁移后没有市场影响', () => {
    const g = seasoned();
    g.state.market.traffic = { factor: 0.85, untilDay: 8 };
    g.state.market.salePrice = { factor: 0.9, untilDay: 7 };
    addEvent(g, 'price_war');
    const back: any = parseSave(serializeState(g.state));
    assert.equal(back.kind, 'ok');
    assert.deepEqual(back.state.market, g.state.market);
    assert.equal(back.state.events[0].type, 'price_war');

    const v6: any = JSON.parse(serializeState(newSession().state));
    v6.schema_version = 6;
    delete v6.state.market;
    const migrated: any = parseSave(JSON.stringify(v6));
    assert.equal(migrated.kind, 'ok');
    assert.deepEqual(migrated.state.market, { traffic: null, supplyCost: null, salePrice: null });

    const bad: any = JSON.parse(serializeState(newSession().state));
    bad.state.market.traffic = { factor: -1, untilDay: 3 };
    assert.equal((parseSave(JSON.stringify(bad)) as any).kind, 'corrupt');
});

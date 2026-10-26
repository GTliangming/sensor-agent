declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { spawnRatePerMinute } from '../../assets/scripts/core/customers/CustomerSystem';
import { CUSTOMER } from '../../assets/scripts/core/data/Balance';
import { addShopper, newSession } from './sim-helpers';

test('客流:满意度越高越多,低于 30 骤减', () => {
    assert.ok(spawnRatePerMinute(100) > spawnRatePerMinute(60));
    assert.ok(spawnRatePerMinute(60) > spawnRatePerMinute(31));
    assert.equal(spawnRatePerMinute(10), CUSTOMER.lowSatPerMin);
    assert.ok(spawnRatePerMinute(29) < spawnRatePerMinute(31) / 2);
});

test('没开门不会来顾客;开门后会来,同时在店里的不超过上限', () => {
    const g = newSession();
    g.tick(0.9);
    for (let i = 0; i < 100; i++) g.tick(1);
    assert.equal(g.state.customers.length, 0);

    const h = newSession();
    h.state.timeOfDay = 0.1;
    h.openStore();
    let maxSeen = 0;
    for (let i = 0; i < 150; i++) {
        h.tick(0.5);
        maxSeen = Math.max(maxSeen, h.state.customers.length);
    }
    assert.ok(h.state.nextCustomerId > 5, `来了 ${h.state.nextCustomerId - 1} 位`);
    assert.ok(maxSeen <= CUSTOMER.maxInStore);
});

test('客流与满意度挂钩:同样时间,满意度高的店来的顾客明显更多', () => {
    const count = (sat: number) => {
        const g = newSession(11);
        g.state.satisfaction = sat;
        g.state.timeOfDay = 0.1;
        g.openStore();
        for (let i = 0; i < 240; i++) g.tick(0.5); // 120 秒(期间不会跨到夜间)
        return g.state.nextCustomerId - 1;
    };
    assert.ok(count(100) > count(10) * 3);
});

test('相同种子 + 相同操作 => 完全相同的结果(可复现)', () => {
    const run = () => {
        const g = newSession(123);
        g.state.timeOfDay = 0.1;
        g.openStore();
        g.state.stock['shelf_1'] = { chips: 20 };
        for (let i = 0; i < 100; i++) g.tick(0.5);
        return JSON.stringify(g.state);
    };
    assert.equal(run(), run());
});

test('顾客买到想要的:取货、排队、扫码、收款,金币/库存/统计/满意度/经验都对', () => {
    const g = newSession();
    g.state.stock['shelf_1'] = { chips: 5 };
    const id = addShopper(g, 'chips', 2);
    g.tick(0.2);
    const c = g.state.customers[0];
    assert.equal(c.phase, 'queuing');
    assert.equal(g.state.stock['shelf_1'].chips, 3);

    assert.equal(g.collectPayment(id).ok, false); // 没扫码不能收款
    assert.equal(g.scanCustomer(id).ok, true);
    assert.equal(g.scanCustomer(id).ok, false); // 不能重复扫
    const sat = g.state.satisfaction;
    const r: any = g.collectPayment(id);
    assert.equal(r.ok, true);
    assert.equal(g.state.coins, 500 + 10); // 薯片售价 5 × 2
    assert.equal(g.state.customers.length, 0);
    assert.equal(g.state.today.revenue, 10);
    assert.equal(g.state.today.served, 1);
    assert.equal(g.state.today.sold['chips'], 2);
    assert.equal(g.state.totalServed, 1);
    assert.equal(g.state.satisfaction, sat + 1); // 及时收银
    assert.equal(g.state.xp, 4 + 2); // 每单 4 + 每件 1
});

test('缺货:什么都没拿到就走,扣满意度并记录缺货;部分缺货会拿走有的、仍然扣分', () => {
    const g = newSession();
    addShopper(g, 'water', 1);
    const events: string[] = [];
    g.events.on('customerNotice', (n) => events.push(n.type));
    g.tick(0.2);
    assert.equal(g.state.customers.length, 0);
    assert.equal(g.state.satisfaction, 58);
    assert.equal(g.state.today.missed['water'], 1);
    assert.equal(g.state.today.lost, 1);
    assert.deepEqual(events, ['noStock']);

    g.state.stock['shelf_1'] = { chips: 1 };
    addShopper(g, 'chips', 2);
    g.tick(0.2);
    assert.equal(g.state.customers[0].cart[0].units, 1);
    assert.equal(g.state.satisfaction, 56);
});

test('排队太久:顾客生气离开,商品放回货架(库存不丢),扣满意度', () => {
    const g = newSession();
    g.state.stock['shelf_1'] = { chips: 4 };
    addShopper(g, 'chips', 2);
    g.tick(0.2);
    assert.equal(g.state.stock['shelf_1'].chips, 2);
    const events: string[] = [];
    g.events.on('customerNotice', (n) => events.push(n.type));
    g.tick(CUSTOMER.queuePatience + 1);
    assert.equal(g.state.customers.length, 0);
    assert.equal(g.state.stock['shelf_1'].chips, 4);
    assert.equal(g.state.satisfaction, 57);
    assert.deepEqual(events, ['angry']);
});

test('收银台前排满了,新来的顾客直接走', () => {
    const g = newSession();
    g.state.stock['shelf_1'] = { chips: 20 };
    for (let i = 0; i < CUSTOMER.queueCap; i++) addShopper(g, 'chips', 1, 0.1);
    g.tick(0.2);
    assert.equal(g.state.customers.length, CUSTOMER.queueCap);
    addShopper(g, 'chips', 1);
    const events: string[] = [];
    g.events.on('customerNotice', (n) => events.push(n.type));
    g.tick(0.2);
    assert.deepEqual(events, ['queueFull']);
    assert.equal(g.state.customers.length, CUSTOMER.queueCap);
    assert.equal(g.state.stock['shelf_1'].chips, 20 - CUSTOMER.queueCap); // 被拒绝的顾客没拿东西
});

test('必须按先来后到接待;收完队首后下一位成为队首', () => {
    const g = newSession();
    g.state.stock['shelf_1'] = { chips: 5 };
    const a = addShopper(g, 'chips', 1, 0.1);
    const b = addShopper(g, 'chips', 1, 0.15);
    g.tick(0.3);
    assert.equal(g.scanCustomer(b).ok, false);
    g.scanCustomer(a);
    g.collectPayment(a);
    assert.equal(g.scanCustomer(b).ok, true);
});

test('打烊:顾客全部离开,排队的被请走(扣满意度),购物车放回货架', () => {
    const g = newSession();
    g.state.timeOfDay = 0.1;
    g.openStore();
    g.state.stock['shelf_1'] = { chips: 6 };
    addShopper(g, 'chips', 2);
    g.tick(0.2);
    assert.equal(g.state.stock['shelf_1'].chips, 4);
    const sat = g.state.satisfaction;
    g.closeStore();
    assert.equal(g.state.customers.length, 0);
    assert.equal(g.state.stock['shelf_1'].chips, 6);
    assert.equal(g.state.satisfaction, sat - 2);
});

test('新手引导期间,顾客想买的第一样东西一定是货架上有的', () => {
    const g = newSession(5);
    g.state.tutorial = { step: 5, moved: true }; // 引导尚未完成
    g.state.timeOfDay = 0.1;
    g.openStore();
    g.state.stock['shelf_1'] = { biscuit: 500 };
    const seen: { [id: number]: string } = {};
    for (let i = 0; i < 80; i++) {
        g.tick(0.5);
        for (const c of g.state.customers) seen[c.id] = c.wants[0].itemId;
    }
    const firstWants = Object.keys(seen).map((k) => seen[Number(k)]);
    assert.ok(firstWants.length >= 3, `只来了 ${firstWants.length} 位`);
    for (const w of firstWants) assert.equal(w, 'biscuit');
});

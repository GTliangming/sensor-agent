declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { STREET_STORE_LAYOUT as L } from './fixtures';
import { distanceToRect, findNearbyFixture } from '../../assets/scripts/core/world/Interaction';

const order = (over: any = {}) => ({
    id: 1,
    itemId: 'chips',
    quantity: 1,
    cost: 36,
    status: 'delivering',
    placedAtMinute: 10,
    arriveAtMinute: 100,
    ...over,
});

test('v1 存档迁移到 v2:原有数据保留,订单字段补默认值', () => {
    const v1 = JSON.stringify({
        schema_version: 1,
        state: { coins: 321, satisfaction: 70, level: 2, day: 5, timeOfDay: 0.3, isOpen: false },
    });
    const r: any = parseSave(v1);
    assert.equal(r.kind, 'ok');
    assert.equal(r.state.coins, 321);
    assert.equal(r.state.day, 5);
    assert.deepEqual(r.state.orders, []);
    assert.equal(r.state.nextOrderId, 1);
});

test('含订单的存档往返一致', () => {
    const s = { ...createInitialState(), orders: [order(), order({ id: 2, status: 'arrived' })], nextOrderId: 3 };
    const r: any = parseSave(serializeState(s));
    assert.equal(r.kind, 'ok');
    assert.deepEqual(r.state, s);
});

test('订单字段非法 -> corrupt;nextOrderId 小于已有编号时被修正', () => {
    const base = { ...createInitialState(), orders: [order()], nextOrderId: 2 };
    const bad = (mut: (o: any) => void) => {
        const o = JSON.parse(serializeState(base));
        mut(o);
        return parseSave(JSON.stringify(o)).kind;
    };
    assert.equal(bad((o) => (o.state.orders[0].status = 'lost')), 'corrupt');
    assert.equal(bad((o) => delete o.state.orders[0].itemId), 'corrupt');
    assert.equal(bad((o) => (o.state.orders = 'x')), 'corrupt');
    const o = JSON.parse(serializeState({ ...base, orders: [order({ id: 7 })], nextOrderId: 2 }));
    assert.equal((parseSave(JSON.stringify(o)) as any).state.nextOrderId, 8);
});

test('distanceToRect:内部为 0,侧面为到边距离,角落为欧氏距离', () => {
    const r = { x: 0, z: 0, w: 2, d: 2 };
    assert.equal(distanceToRect(0.5, 0.5, r), 0);
    assert.equal(distanceToRect(3, 0, r), 2);
    assert.ok(Math.abs(distanceToRect(2, 2, r) - Math.SQRT2) < 1e-9);
});

test('findNearbyFixture:走近电脑桌才能触发,远离则为 null,不会误认别的设施', () => {
    const pc = L.fixtures.find((f) => f.kind === 'computer')!;
    const near = findNearbyFixture(pc.x + pc.w / 2 + 0.8, pc.z, L.fixtures, 'computer', 1.8);
    assert.equal(near && near.id, pc.id);
    assert.equal(findNearbyFixture(L.spawn.x, L.spawn.z, L.fixtures, 'computer', 1.8), null);
    assert.equal(findNearbyFixture(pc.x, pc.z, L.fixtures, 'counter', 0.5), null);
});

test('出生点到电脑桌有一段距离,需要走过去(不会一开局就触发)', () => {
    const pc = L.fixtures.find((f) => f.kind === 'computer')!;
    assert.ok(distanceToRect(L.spawn.x, L.spawn.z, pc) > 1.8);
});

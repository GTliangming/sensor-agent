declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { GameSession } from '../../assets/scripts/core/GameSession';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG } from '../../assets/scripts/core/time/GameClock';
import { listActions, runAction } from '../../assets/scripts/core/world/Actions';
import { STREET_STORE_LAYOUT as L } from '../../assets/scripts/core/world/StoreLayout';

const CFG = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };

function newSession(): GameSession {
    const s = createInitialState();
    s.level = 3;
    s.coins = 100000;
    return new GameSession(s, CFG);
}

function deliver(g: GameSession, key: string, qty = 1): number {
    g.placeOrder(key, qty);
    g.expediteOrder(g.state.orders[g.state.orders.length - 1].id);
    return g.state.cartons[g.state.cartons.length - 1].id;
}

const types = (g: GameSession, x: number, z: number) => listActions(g.state, L, x, z).map((a) => a.type);

test('取回商品:手上为空时新建纸箱;手上有同种商品时合并;拿别的会被拒绝', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips'));
    g.stockContainer('shelf_1', 'all');
    assert.equal(g.takeFromContainer('shelf_1', 'chips', 5).ok, true);
    assert.equal(g.carried!.units, 5);
    assert.equal(g.carried!.orderId, null);
    assert.equal(g.takeFromContainer('shelf_1', 'chips', 3).ok, true);
    assert.equal(g.carried!.units, 8);
    assert.equal(g.state.stock['shelf_1'].chips, 4); // 12 - 5 - 3

    g.stockContainer('shelf_2', 'all'); // 把手上的 8 件放到另一个货架 -> 调换位置
    assert.equal(g.carried, null);
    assert.equal(g.state.stock['shelf_2'].chips, 8);

    g.pickUpCarton(deliver(g, 'water'));
    assert.equal((g.takeFromContainer('shelf_1', 'chips', 1) as any).code, 'state');
    assert.equal((g.takeFromContainer('shelf_3', 'chips', 1) as any).code, 'invalid');
});

test('拿空一个货架后,库存里不留空记录', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips'));
    g.stockContainer('shelf_1', 'all');
    g.takeFromContainer('shelf_1', 'chips', 'all');
    assert.deepEqual(g.state.stock, {});
});

test('设备纸箱只能收进仓库,商品纸箱不能收进仓库', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'equip:extinguisher', 2));
    assert.equal((g.stockContainer('shelf_1', 1) as any).code, 'invalid');
    const r: any = g.storeEquipment();
    assert.equal(r.ok, true);
    assert.equal(g.state.warehouse['extinguisher'], 2);
    assert.equal(g.state.cartons.length, 0);
    assert.equal(g.state.orders.length, 0);

    g.pickUpCarton(deliver(g, 'chips'));
    assert.equal((g.storeEquipment() as any).code, 'invalid');
});

test('动作清单:在店门口卸货区能搬纸箱;抱着纸箱走到货架旁能放入;离得远什么都没有', () => {
    const g = newSession();
    deliver(g, 'chips');
    assert.deepEqual(types(g, 4, 5), ['pickUpCarton']);
    assert.deepEqual(types(g, 0, 0.5), []); // 店中间,既不靠近卸货区也不靠近货架
    runAction(g, listActions(g.state, L, 4, 5)[0]);
    assert.ok(g.carried);
    assert.deepEqual(types(g, 4, 5), ['putDownCarton']);
    assert.deepEqual(types(g, 0, -1.2), ['stock', 'stock']); // shelf_2 旁:放 1 件 / 全部放入
});

test('抱着商品站在冷柜旁:动作仍然给出,点击后得到"放错容器"的提示', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips'));
    const a = listActions(g.state, L, 4.6, 0.2).find((x) => x.type === 'stock')!;
    const r: any = runAction(g, a);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'wrong_container');
});

test('货架上有货时,站在旁边手上为空会出现"拿起"动作;电脑桌旁出现 openComputer', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips'));
    g.stockContainer('shelf_2', 'all');
    assert.deepEqual(types(g, 0, -1.2), ['take', 'pickUpFixture']); // 货架旁还可以把整个货架收回仓库
    assert.deepEqual(types(g, -4.2, 2.4), ['openComputer']);
    assert.equal((runAction(g, { type: 'openComputer', label: '' }) as any).ok, false);
});

test('抱着设备纸箱:任何地方都能收进仓库', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'equip:poster'));
    assert.deepEqual(types(g, 0, 0.5), ['storeEquipment']);
});

test('存档 v2 -> v3 迁移:已送达未处理的订单变成卸货区纸箱', () => {
    const v2 = JSON.stringify({
        schema_version: 2,
        state: {
            coins: 100, satisfaction: 60, level: 1, day: 3, timeOfDay: 0.2, isOpen: false, nextOrderId: 3,
            orders: [
                { id: 1, itemId: 'chips', quantity: 2, cost: 72, status: 'arrived', placedAtMinute: 1, arriveAtMinute: 2 },
                { id: 2, itemId: 'water', quantity: 1, cost: 12, status: 'delivering', placedAtMinute: 5, arriveAtMinute: 99 },
            ],
        },
    });
    const r: any = parseSave(v2);
    assert.equal(r.kind, 'ok');
    assert.equal(r.state.cartons.length, 1);
    assert.deepEqual({ ...r.state.cartons[0] }, { id: 1, orderId: 1, itemId: 'chips', units: 24, location: 'door', xpLeft: 24 });
    assert.equal(r.state.nextCartonId, 2);
    assert.deepEqual(r.state.stock, {});
});

test('存档 v3 往返一致;非法的库存/纸箱判为 corrupt', () => {
    const s = {
        ...createInitialState(),
        cartons: [{ id: 4, orderId: null, itemId: 'chips', units: 3, location: 'hands' as const, xpLeft: 0 }],
        nextCartonId: 5,
        stock: { shelf_1: { chips: 7 } },
        warehouse: { poster: 2 },
    };
    const r: any = parseSave(serializeState(s));
    assert.equal(r.kind, 'ok');
    assert.deepEqual(r.state, s);

    const bad = (mut: (o: any) => void) => {
        const o = JSON.parse(serializeState(s));
        mut(o);
        return parseSave(JSON.stringify(o)).kind;
    };
    assert.equal(bad((o) => (o.state.stock.shelf_1.chips = -1)), 'corrupt');
    assert.equal(bad((o) => (o.state.stock = [])), 'corrupt');
    assert.equal(bad((o) => (o.state.cartons[0].units = 0)), 'corrupt');
    assert.equal(bad((o) => o.state.cartons.push({ ...o.state.cartons[0], id: 9 })), 'corrupt'); // 手里两个纸箱
    assert.equal(bad((o) => delete o.state.warehouse), 'corrupt');
});

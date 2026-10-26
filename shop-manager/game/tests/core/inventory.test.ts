declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { GameSession } from '../../assets/scripts/core/GameSession';
import { getCatalogItem } from '../../assets/scripts/core/data/Catalog';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG } from '../../assets/scripts/core/time/GameClock';

const CFG = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };

/** 等级 3、金币充足的会话,方便订购任何商品。 */
function newSession(): GameSession {
    const s = createInitialState();
    s.level = 3;
    s.coins = 100000;
    return new GameSession(s, CFG);
}

/** 下单并立刻送达,返回新纸箱的 id。 */
function deliver(g: GameSession, key: string, qty = 1): number {
    assert.equal(g.placeOrder(key, qty).ok, true);
    const order = g.state.orders[g.state.orders.length - 1];
    assert.equal(g.expediteOrder(order.id).ok, true);
    return g.state.cartons[g.state.cartons.length - 1].id;
}

const totalUnits = (g: GameSession, itemId: string) => {
    let n = 0;
    for (const c of g.state.cartons) if (c.itemId === itemId) n += c.units;
    for (const f of Object.keys(g.state.stock)) n += g.state.stock[f][itemId] ?? 0;
    return n;
};

test('订单送达后在卸货区生成纸箱:商品件数 = 批数 × 每批件数,设备 = 件数', () => {
    const g = newSession();
    deliver(g, 'chips', 2);
    deliver(g, 'equip:extinguisher', 3);
    const [a, b] = g.state.cartons;
    assert.equal(a.units, 2 * (getCatalogItem('chips') as any).batchSize);
    assert.equal(a.location, 'door');
    assert.equal(b.units, 3);
});

test('手上最多抱一个纸箱;可以放回卸货区', () => {
    const g = newSession();
    const a = deliver(g, 'chips');
    const b = deliver(g, 'water');
    assert.equal(g.pickUpCarton(a).ok, true);
    assert.equal((g.pickUpCarton(b) as any).code, 'state');
    assert.equal(g.carried!.id, a);
    assert.equal(g.putDownCarton().ok, true);
    assert.equal(g.carried, null);
    assert.equal((g.putDownCarton() as any).code, 'state');
    assert.equal((g.pickUpCarton(999) as any).code, 'invalid');
});

test('上架:零食放进普通货架,库存增加、纸箱减少', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips')); // 12 件
    const r: any = g.stockContainer('shelf_1', 5);
    assert.equal(r.ok, true);
    assert.equal(g.state.stock['shelf_1'].chips, 5);
    assert.equal(g.carried!.units, 7);
});

test('放错容器被拒绝并说明原因:雪糕不能上货架、零食不能进冷柜、糕点要玻璃展柜', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'icecream'));
    const r1: any = g.stockContainer('shelf_1', 'all');
    assert.equal(r1.code, 'wrong_container');
    assert.ok(r1.reason.includes('冷柜'), r1.reason);
    assert.equal(g.stockContainer('fridge_1', 'all').ok, true);
    g.pickUpCarton(deliver(g, 'chips'));
    assert.equal((g.stockContainer('fridge_1', 'all') as any).code, 'wrong_container');
    g.putDownCarton();
    g.pickUpCarton(deliver(g, 'cake'));
    const r3: any = g.stockContainer('shelf_2', 'all');
    assert.equal(r3.code, 'wrong_container');
    assert.ok(r3.reason.includes('玻璃展柜'), r3.reason);
});

test('柜台和电脑桌不能存放商品', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips'));
    assert.equal((g.stockContainer('counter_1', 1) as any).code, 'wrong_container');
    assert.equal((g.stockContainer('computer_1', 1) as any).code, 'wrong_container');
    assert.equal((g.stockContainer('nope', 1) as any).code, 'invalid');
});

test('容量上限:放满后放不进去;剩余的留在纸箱里换个货架继续放;全部放完订单结束', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips', 3)); // 36 件,货架 24 格
    const r1: any = g.stockContainer('shelf_1', 'all');
    assert.equal(r1.ok, true);
    assert.ok(r1.info.includes('满了'), r1.info);
    assert.equal(g.state.stock['shelf_1'].chips, 24);
    assert.equal(g.carried!.units, 12);
    assert.equal((g.stockContainer('shelf_1', 1) as any).code, 'full');
    assert.equal(g.stockContainer('shelf_2', 'all').ok, true);
    assert.equal(g.carried, null);
    assert.equal(g.state.cartons.length, 0);
    assert.equal(g.state.orders.length, 0); // 订单随纸箱清空而完成
});

test('占多格的商品按格子数算容量:冷柜 18 格放水饺(每件 2 格)最多 9 件', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'dumpling', 2)); // 12 件
    assert.equal(g.stockContainer('fridge_1', 'all').ok, true);
    assert.equal(g.state.stock['fridge_1'].dumpling, 9);
    assert.equal(g.carried!.units, 3);
});

test('库存守恒:无论怎么搬运,纸箱 + 货架里的总件数始终等于订购件数', () => {
    const g = newSession();
    g.pickUpCarton(deliver(g, 'chips', 3));
    g.stockContainer('shelf_1', 10);
    g.putDownCarton();
    assert.equal(totalUnits(g, 'chips'), 36);
    g.pickUpCarton(g.state.cartons[0].id);
    g.stockContainer('shelf_2', 'all');
    g.takeFromContainer('shelf_1', 'chips', 4);
    assert.equal(totalUnits(g, 'chips'), 36);
});

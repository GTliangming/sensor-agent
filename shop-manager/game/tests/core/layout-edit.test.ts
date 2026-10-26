declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { EXPANSIONS, getCatalogItem } from '../../assets/scripts/core/data/Catalog';
import { checkPlacement, makeFixture, unreachablePlace } from '../../assets/scripts/core/world/Placement';
import { EXPANSION_SIZES, STREET_STORE_LAYOUT as L, buildLayout, initialFixtures, interiorFor, obstaclesOf, wallsFor } from '../../assets/scripts/core/world/StoreLayout';
import { newSession } from './sim-helpers';

const def = (id: string) => getCatalogItem(`equip:${id}`) as any;

/** 给会话的仓库里放一件设备(跳过采购流程,专注测摆放)。 */
function stock(g: ReturnType<typeof newSession>, equipId: string, n = 1) {
    g.state.warehouse[equipId] = (g.state.warehouse[equipId] ?? 0) + n;
}

test('初始布局与各扩建等级下,店门到所有设施、排队位都走得通', () => {
    assert.equal(unreachablePlace(L), null);
    for (let level = 0; level < EXPANSION_SIZES.length; level++) {
        assert.equal(unreachablePlace(buildLayout(level, initialFixtures())), null, `扩建 ${level} 级`);
    }
});

test('扩建后的墙体:南墙门洞位置不变,店向北和两侧扩大;设施都在店内', () => {
    for (let level = 0; level < EXPANSION_SIZES.length; level++) {
        const room = interiorFor(level);
        assert.equal(room.z + room.d / 2, 4); // 南墙(门所在)永远在 z=4
        const south = wallsFor(room).filter((w) => Math.abs(w.z - 4.1) < 1e-9);
        assert.equal(south.length, 2);
        const gap = south.filter((w) => w.x > 0)[0].x - south.filter((w) => w.x > 0)[0].w / 2 - (south.filter((w) => w.x < 0)[0].x + south.filter((w) => w.x < 0)[0].w / 2);
        assert.ok(Math.abs(gap - 2) < 1e-9, `门洞 ${gap}`);
        for (const f of initialFixtures()) {
            assert.ok(Math.abs(f.x - room.x) + f.w / 2 <= room.w / 2 && Math.abs(f.z - room.z) + f.d / 2 <= room.d / 2, f.id);
        }
    }
    assert.equal(EXPANSIONS.length, EXPANSION_SIZES.length);
});

test('摆放:合法位置可以放;重叠、离得太近、超出店内、堵住店门都会被拒绝并说明原因', () => {
    const shelf = def('shelf');
    assert.equal(checkPlacement(L, shelf, -4, 0.5, 0), null);
    assert.ok(checkPlacement(L, shelf, 0, -2.2, 0)!.includes('已经有东西'));
    assert.ok(checkPlacement(L, shelf, 0, -1.1, 0)!.includes('太近'));
    assert.ok(checkPlacement(L, shelf, 7, 0, 0)!.includes('超出'));
    const blockDoor = checkPlacement(L, shelf, 0, 3.0, 0)!;
    assert.ok(blockDoor.includes('堵'), blockDoor);
});

test('摆放会吸附到 0.25 米网格;旋转 90 度后宽深互换、正面朝向改变', () => {
    const g = newSession();
    stock(g, 'fridge');
    assert.equal(g.placeFixture('fridge', -3.06, 0.44, 1).ok, true);
    const f = g.state.fixtures[g.state.fixtures.length - 1];
    assert.equal(f.x, -3);
    assert.equal(f.z, 0.5);
    assert.deepEqual([f.w, f.d], [0.8, 2.0]);
    assert.deepEqual(f.front, { x: -1, z: 0 });
    assert.equal(f.capacity, 18);
    assert.equal(g.state.warehouse['fridge'], undefined); // 用完了,不留 0 的记录
});

test('placeFixture:消耗仓库库存、布局版本 +1、设施 id 不重复;仓库没有时拒绝', () => {
    const g = newSession();
    assert.equal((g.placeFixture('shelf', -4, 0.5, 0) as any).code, 'state');
    stock(g, 'shelf', 2);
    const v0 = g.layoutVersion;
    assert.equal(g.placeFixture('shelf', -4, 0.5, 0).ok, true);
    assert.equal(g.placeFixture('shelf', -4, 1.0, 0).ok, false); // 与刚放的重叠
    assert.equal(g.placeFixture('shelf', -4, -0.5 + 5.5, 0).ok, false); // 靠近门口一侧/出界
    assert.equal(g.layoutVersion, v0 + 1);
    stock(g, 'shelf', 1);
    assert.equal(g.placeFixture('shelf', 0, 0.8, 0).ok, true);
    const ids = g.state.fixtures.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(g.layout.fixtures.length, ids.length); // 布局随设施数组更新
    assert.equal((g.placeFixture('nope', 0, 0, 0) as any).code, 'invalid');
});

test('不挡路的装饰(海报、地垫)可以摆在过道里,但不能压在设施上', () => {
    const g = newSession();
    stock(g, 'poster');
    stock(g, 'antislip_mat');
    assert.equal(g.placeFixture('antislip_mat', 0, 3.4, 0).ok, true);
    assert.equal(g.placeFixture('poster', 0, -2.2, 0).ok, false);
    assert.equal(g.placeFixture('poster', 0, 0.5, 0).ok, true);
    assert.equal(unreachablePlace(g.layout), null);
    // 装饰不进障碍物清单
    assert.equal(obstaclesOf(g.layout).length, obstaclesOf(L).length);
});

test('收回设备:空的才能收;收银台和电脑桌搬不动;收回后进仓库可以再摆', () => {
    const g = newSession();
    g.state.stock['shelf_1'] = { chips: 3 };
    assert.ok((g.pickUpFixture('shelf_1') as any).reason.includes('商品'));
    assert.equal((g.pickUpFixture('counter_1') as any).code, 'state');
    assert.equal((g.pickUpFixture('nope') as any).code, 'invalid');
    const v0 = g.layoutVersion;
    assert.equal(g.pickUpFixture('shelf_2').ok, true);
    assert.equal(g.state.warehouse['shelf'], 1);
    assert.equal(g.layoutVersion, v0 + 1);
    assert.equal(g.layout.fixtures.some((f) => f.id === 'shelf_2'), false);
    assert.equal(g.placeFixture('shelf', 0, -2.2, 0).ok, true); // 放回原位
});

test('收回所有货架后,顾客不会让程序出错', () => {
    const g = newSession();
    for (const id of ['shelf_1', 'shelf_2', 'shelf_3', 'fridge_1']) g.pickUpFixture(id);
    g.state.timeOfDay = 0.1;
    g.openStore();
    for (let i = 0; i < 120; i++) g.tick(0.5);
    assert.ok(g.state.nextCustomerId > 1);
});

test('扩建:需要等级和金币,成功后店内变大并扣钱;到顶后拒绝', () => {
    const g = newSession();
    assert.equal((g.expandStore() as any).code, 'locked'); // 1 级不够
    g.state.level = EXPANSIONS[1].unlockLevel;
    g.state.coins = EXPANSIONS[1].cost - 1;
    const r: any = g.expandStore();
    assert.equal(r.code, 'insufficient_coins');
    g.state.coins = EXPANSIONS[1].cost + 10;
    const v0 = g.layoutVersion;
    assert.equal(g.expandStore().ok, true);
    assert.equal(g.state.coins, 10);
    assert.equal(g.state.expansion, 1);
    assert.deepEqual([g.layout.interior.w, g.layout.interior.d], [EXPANSION_SIZES[1].w, EXPANSION_SIZES[1].d]);
    assert.equal(g.layoutVersion, v0 + 1);

    g.state.level = 10;
    g.state.coins = 100000;
    assert.equal(g.expandStore().ok, true);
    assert.equal((g.expandStore() as any).code, 'state');
});

test('扩建出来的空地可以摆设备(摆在原来放不下的位置)', () => {
    const g = newSession();
    stock(g, 'shelf');
    assert.equal(g.placeFixture('shelf', 0, -5.5, 0).ok, false); // 小店装不下
    g.state.expansion = 1;
    assert.equal(g.placeFixture('shelf', 0, -5.0, 0).ok, true);
});

test('makeFixture 不留下 undefined 字段(存档往返才一致)', () => {
    const f = makeFixture('x', def('poster'), 0, 0, 0);
    assert.equal(Object.prototype.hasOwnProperty.call(f, 'capacity'), false);
});

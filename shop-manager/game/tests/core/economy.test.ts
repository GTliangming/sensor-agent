declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { ADS, DISTRESS, MERCHANT, STAFF } from '../../assets/scripts/core/data/Balance';
import { AD_COIN_REWARD } from '../../assets/scripts/core/data/Catalog';
import { getMerchant } from '../../assets/scripts/core/data/Merchants';
import { GameSession } from '../../assets/scripts/core/GameSession';
import { renewFee } from '../../assets/scripts/core/merchants/MerchantSystem';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { activeFactor } from '../../assets/scripts/core/events/EventSystem';
import { addShopper, newSession } from './sim-helpers';

/** 过一天(不触发随机事件)。 */
function nextDay(g: GameSession): void {
    g.state.eventCooldown = 1e9;
    g.state.timeOfDay = 0.99;
    g.tick(240 * 0.02);
}

/** 可以招商的会话:4 级、扩建 1 次、金币充足。 */
function merchantSession(): GameSession {
    const g = newSession(4);
    g.state.level = 4;
    g.state.expansion = 1;
    g.state.coins = 2000;
    g.state.eventCooldown = 1e9;
    return g;
}

// ---------------------------------------------------------------- 招商

test('招商:没到等级或没扩建不能签约;签约扣押金,每天收租', () => {
    const g = newSession(4);
    g.state.coins = 2000;
    assert.equal((g.signMerchant(0, 'fruit') as any).code, 'locked');
    g.state.level = 4;
    assert.equal((g.signMerchant(0, 'fruit') as any).code, 'locked'); // 没扩建

    const m = merchantSession();
    const fruit = getMerchant('fruit')!;
    assert.equal(m.signMerchant(0, 'fruit').ok, true);
    assert.equal(m.state.coins, 2000 - fruit.deposit);
    assert.equal((m.signMerchant(0, 'bakery') as any).code, 'state'); // 档口被占
    assert.equal((m.signMerchant(1, 'bakery') as any).code, 'invalid'); // 只扩建了 1 次,只有 1 个档口
    assert.equal((m.signMerchant(0, 'deli') as any).code, 'state'); // 同一个档口

    const before = m.state.coins;
    nextDay(m);
    assert.equal(m.state.coins, before + fruit.rentPerDay);
});

test('招商:押金不够/等级不够会被拒绝', () => {
    const g = merchantSession();
    g.state.coins = 10;
    assert.equal((g.signMerchant(0, 'fruit') as any).code, 'insufficient_coins');
    g.state.coins = 2000;
    assert.equal((g.signMerchant(0, 'deli') as any).code, 'locked'); // 熟食档要 6 级
});

test('招商:满意度连续偏低 -> 先预警,再解约搬走并退押金', () => {
    const g = merchantSession();
    const def = getMerchant('milktea')!;
    g.state.level = 5;
    g.signMerchant(0, 'milktea');
    const notices: any[] = [];
    g.events.on('merchantNotice', (n) => notices.push(n.type));
    const afterSign = g.state.coins;

    g.state.satisfaction = MERCHANT.minSatisfaction - 5;
    nextDay(g);
    assert.equal(g.state.merchants.length, 1);
    assert.equal(g.state.merchants[0].badDays, 1);
    assert.ok(notices.indexOf('warning') >= 0);

    nextDay(g);
    assert.equal(g.state.merchants.length, 0);
    assert.ok(notices.indexOf('left') >= 0);
    assert.equal(g.state.coins, afterSign + def.rentPerDay * 2 + def.deposit);
});

test('招商:好的一天会清掉预警;事故太多也算糟糕的一天', () => {
    const g = merchantSession();
    g.signMerchant(0, 'fruit');
    g.state.satisfaction = 10;
    nextDay(g);
    assert.equal(g.state.merchants[0].badDays, 1);
    g.state.satisfaction = 80;
    nextDay(g);
    assert.equal(g.state.merchants[0].badDays, 0);

    g.state.incidentsToday = MERCHANT.maxIncidents;
    nextDay(g);
    assert.equal(g.state.merchants[0].badDays, 1);
    assert.equal(g.state.incidentsToday, 0); // 新的一天清零
});

test('招商:超时没处理的事件会计入事故数', () => {
    const g = merchantSession();
    g.state.day = 6;
    g.state.timeOfDay = 0.05;
    g.state.events.push({ id: 1, type: 'supplier_discount', itemId: null, remainingSec: 1, totalSec: 45 });
    g.state.nextEventId = 2;
    g.tick(2);
    assert.equal(g.state.incidentsToday, 1);
});

test('招商:租约到期搬走并退押金;续约延长租期;收回铺面退押金', () => {
    const g = merchantSession();
    const def = getMerchant('fruit')!;
    g.signMerchant(0, 'fruit');
    g.state.merchants[0].expiresDay = g.state.day; // 今天到期
    const coins = g.state.coins;
    nextDay(g);
    assert.equal(g.state.merchants.length, 0);
    assert.equal(g.state.coins, coins + def.rentPerDay + def.deposit);

    const r = merchantSession();
    r.signMerchant(0, 'fruit');
    const c0 = r.state.coins;
    assert.equal(r.renewMerchant(0).ok, true);
    assert.equal(r.state.coins, c0 - renewFee('fruit'));
    assert.equal(r.state.merchants[0].expiresDay, r.state.day + MERCHANT.termDays - 1 + MERCHANT.termDays);
    assert.equal((r.renewMerchant(1) as any).code, 'invalid');

    const c1 = r.state.coins;
    assert.equal(r.reclaimMerchant(0).ok, true);
    assert.equal(r.state.coins, c1 + def.deposit);
    assert.equal(r.state.merchants.length, 0);
    assert.equal((r.reclaimMerchant(0) as any).code, 'invalid');
    assert.equal(r.signMerchant(0, 'bakery').ok, true); // 收回后可以换商户
});

// ---------------------------------------------------------------- 员工

test('员工:等级不够/金币不够/重复雇佣都不行;可以辞退', () => {
    const g = newSession(5);
    g.state.coins = 1000;
    assert.equal((g.hireStaff('cashier') as any).code, 'locked');
    g.state.level = 5;
    g.state.coins = 10;
    assert.equal((g.hireStaff('cashier') as any).code, 'insufficient_coins');
    g.state.coins = 1000;
    assert.equal(g.hireStaff('cashier').ok, true);
    assert.equal(g.state.coins, 1000 - STAFF.cashier.hireFee);
    assert.equal((g.hireStaff('cashier') as any).code, 'state');
    assert.equal(g.fireStaff(g.state.staff[0].id).ok, true);
    assert.equal(g.state.staff.length, 0);
    assert.equal((g.fireStaff(99) as any).code, 'invalid');
});

test('收银员自动扫码收款,结果和玩家亲手收银一样(金币、库存、经验)', () => {
    const run = (hired: boolean) => {
        const g = newSession(6);
        g.state.level = 4;
        g.state.eventCooldown = 1e9;
        g.state.stock['shelf_1'] = { chips: 10 };
        if (hired) g.hireStaff('cashier');
        const id = addShopper(g, 'chips', 1, 0.1);
        g.tick(0.2); // 逛完,去排队
        if (hired) {
            g.tick(STAFF.cashier.stepSec + 0.1); // 扫码
            g.tick(STAFF.cashier.stepSec + 0.1); // 收款
        } else {
            g.scanCustomer(id);
            g.collectPayment(id);
        }
        return g;
    };
    const auto = run(true);
    const hand = run(false);
    assert.equal(auto.state.customers.length, 0);
    assert.equal(auto.state.totalServed, 1);
    assert.equal(auto.state.coins, hand.state.coins - STAFF.cashier.hireFee);
    assert.equal(auto.state.xp, hand.state.xp);
    assert.deepEqual(auto.state.stock, hand.state.stock);
});

test('理货员自动把卸货区的商品上架、设备收进仓库', () => {
    const g = newSession(7);
    g.state.level = 5;
    g.state.coins = 2000;
    g.state.eventCooldown = 1e9;
    g.hireStaff('stocker');
    g.placeOrder('chips', 1);
    g.placeOrder('equip:price_tag', 1);
    for (const o of g.state.orders.slice()) g.expediteOrder(o.id);
    assert.equal(g.state.cartons.length, 2);

    g.tick(STAFF.stocker.stepSec + 0.1);
    g.tick(STAFF.stocker.stepSec + 0.1);
    assert.equal(g.state.cartons.length, 0);
    assert.equal(g.state.orders.length, 0);
    let chips = 0;
    for (const id of Object.keys(g.state.stock)) chips += g.state.stock[id].chips ?? 0;
    assert.equal(chips, 12);
    assert.equal(g.state.warehouse['price_tag'], 1);
    assert.ok(g.state.xp > 0); // 上架经验照给
});

test('员工工资:每天扣;金币不够发就离职', () => {
    const g = newSession(8);
    g.state.level = 5;
    g.state.coins = 1000;
    g.hireStaff('cashier');
    g.hireStaff('stocker');
    const notices: any[] = [];
    g.events.on('staffNotice', (n) => notices.push(n));
    const c0 = g.state.coins;
    nextDay(g);
    assert.equal(g.state.coins, c0 - STAFF.cashier.wage - STAFF.stocker.wage);
    assert.equal(g.state.staff.length, 2);

    g.state.coins = STAFF.cashier.wage; // 只够发第一位
    nextDay(g);
    assert.deepEqual(g.state.staff.map((s) => s.role), ['cashier']);
    assert.equal(g.state.coins, 0);
    assert.ok(notices.some((n) => n.type === 'quit' && n.role === 'stocker'));
});

// ---------------------------------------------------------------- 广告与资金紧张

test('广告:每个场景每天有次数上限,跨天重置', () => {
    const g = newSession(9);
    g.state.coins = 0;
    const cap = ADS.dailyCap['coins'];
    for (let i = 0; i < cap; i++) assert.equal(g.rewardCoinsFromAd().ok, true);
    assert.equal(g.state.coins, cap * AD_COIN_REWARD);
    assert.equal(g.adRemaining('coins'), 0);
    assert.equal((g.rewardCoinsFromAd() as any).code, 'state');
    assert.equal(g.state.coins, cap * AD_COIN_REWARD); // 超限不发奖励
    nextDay(g);
    assert.equal(g.adRemaining('coins'), cap);
    assert.equal(g.rewardCoinsFromAd().ok, true);
});

test('广告:失败的命令不占次数;人气 buff 提高客流且有上限', () => {
    const g = newSession(9);
    const before = g.adRemaining('expedite_order');
    assert.equal(g.expediteOrderFromAd(123).ok, false); // 没有这张订单
    assert.equal(g.adRemaining('expedite_order'), before);
    assert.equal(g.unlockThemeFromAd('nope').ok, false);
    assert.equal(g.adRemaining('theme'), ADS.dailyCap['theme']);

    assert.equal(g.activateBuffFromAd().ok, true);
    assert.equal(activeFactor(g.state, g.state.market.traffic), ADS.buffTraffic);
    assert.equal(g.activateBuffFromAd().ok, true);
    assert.equal((g.activateBuffFromAd() as any).code, 'state');
});

test('资金紧张:金币少又没货连续几天 -> 不能买设备,可以卖设备/多看广告,金币够了就恢复', () => {
    const g = newSession(10);
    g.state.coins = 10;
    g.state.warehouse['antislip_mat'] = 1;
    assert.equal(g.placeFixture('antislip_mat', 0, 3.4, 0).ok, true);
    const changes: boolean[] = [];
    g.events.on('distressChanged', (e) => changes.push(e.distress));

    nextDay(g);
    assert.equal(g.distress, false);
    nextDay(g);
    assert.equal(g.distress, true);
    assert.deepEqual(changes, [true]);
    const r: any = g.placeOrder('equip:shelf', 1);
    assert.equal(r.ok, false);
    assert.ok(r.reason.includes('资金紧张'));
    assert.equal(g.adRemaining('coins'), ADS.dailyCap['coins'] + ADS.distressExtraCoinAds);

    const mat = g.state.fixtures[g.state.fixtures.length - 1];
    assert.equal(g.sellFixture(mat.id).ok, true);
    assert.equal(g.state.coins, 10 + Math.round(80 * DISTRESS.sellRatio));
    assert.equal((g.sellFixture('no_such_fixture') as any).ok, false);

    g.state.coins = DISTRESS.recoverCoins;
    assert.equal(g.distress, false);
    assert.equal(g.placeOrder('equip:price_tag', 1).ok, true); // 脱离紧张后又能买设备了
});

test('有货可卖就不算资金紧张', () => {
    const g = newSession(10);
    g.state.coins = 10;
    g.state.stock['shelf_1'] = { chips: 3 };
    nextDay(g);
    nextDay(g);
    assert.equal(g.distress, false);
    assert.equal(g.state.distressDays, 0);
});

// ---------------------------------------------------------------- 存档

test('存档 v9:商户/员工/广告次数往返不丢;v8 旧存档迁移;坏数据被拒绝', () => {
    const g = merchantSession();
    g.state.level = 5;
    g.signMerchant(0, 'fruit');
    g.hireStaff('cashier');
    g.rewardCoinsFromAd();
    g.state.distressDays = 1;
    const back: any = parseSave(serializeState(g.state));
    assert.equal(back.kind, 'ok');
    assert.deepEqual(back.state.merchants, g.state.merchants);
    assert.deepEqual(back.state.staff, g.state.staff);
    assert.deepEqual(back.state.ads, g.state.ads);
    assert.equal(back.state.distressDays, 1);
    assert.equal(back.state.nextStaffId, g.state.nextStaffId);

    const v8: any = JSON.parse(serializeState(newSession().state));
    v8.schema_version = 8;
    for (const k of ['merchants', 'staff', 'nextStaffId', 'ads', 'distressDays', 'incidentsToday']) delete v8.state[k];
    const migrated: any = parseSave(JSON.stringify(v8));
    assert.equal(migrated.kind, 'ok');
    assert.deepEqual([migrated.state.merchants, migrated.state.staff, migrated.state.distressDays], [[], [], 0]);
    assert.equal(migrated.state.ads.day, v8.state.day);

    const bad: any = JSON.parse(serializeState(g.state));
    bad.state.staff[0].role = 'boss';
    assert.equal((parseSave(JSON.stringify(bad)) as any).kind, 'corrupt');
    const dup: any = JSON.parse(serializeState(g.state));
    dup.state.merchants.push({ ...dup.state.merchants[0] });
    assert.equal((parseSave(JSON.stringify(dup)) as any).kind, 'corrupt');
});

// ---------------------------------------------------------------- 防止"满意度归零"的死循环

test('进入资金紧张:一次性救济——卸货区送 3 批最便宜的商品,满意度托到 35 以上,之后不再重复送', () => {
    const g = newSession(10);
    g.state.coins = 10;
    g.state.satisfaction = 3;
    const relief: string[][] = [];
    g.events.on('distressChanged', (e) => relief.push(e.relief));

    nextDay(g);
    assert.equal(g.state.cartons.length, 0); // 第一天只是计数
    nextDay(g); // 第二天进入紧张
    assert.equal(g.distress, true);
    assert.equal(g.state.cartons.length, DISTRESS.reliefBatches);
    assert.ok(g.state.cartons.every((c) => c.location === 'door' && c.orderId === null && c.xpLeft === 0));
    assert.deepEqual(g.state.cartons.map((c) => c.itemId).sort(), ['biscuit', 'cola', 'water']);
    assert.ok(g.state.satisfaction >= DISTRESS.reliefSatisfaction);
    assert.equal(relief.length, 1);
    assert.equal(relief[0].length, DISTRESS.reliefBatches);

    nextDay(g); // 有货在手就不再算"没货可卖":紧张解除,也不会再送一轮
    assert.equal(g.distress, false);
    assert.equal(g.state.cartons.length, DISTRESS.reliefBatches);
    assert.deepEqual(relief.map((r) => r.length), [DISTRESS.reliefBatches, 0]);
});

test('满意度已经很低时,及时收银的回暖加成更大(口碑能一点点爬回来)', () => {
    const served = (satisfaction: number) => {
        const g = newSession(3);
        g.state.eventCooldown = 1e9;
        g.state.stock['shelf_1'] = { chips: 10 };
        const id = addShopper(g, 'chips', 1, 0.1);
        g.tick(0.2);
        g.state.satisfaction = satisfaction;
        g.scanCustomer(id);
        g.collectPayment(id);
        return g.state.satisfaction - satisfaction;
    };
    assert.equal(served(60), 1);
    assert.equal(served(10), 2);
});

test('极端开局(金币 0、满意度 0、没货)也能被救回来,不会卡死', () => {
    for (const seed of [1, 7, 42]) {
        const g = newSession(seed);
        g.state.day = 5;
        g.state.level = 2;
        g.state.coins = 0;
        g.state.satisfaction = 0;
        g.state.timeOfDay = 0.99;
        g.tick(240 * 0.02); // 过一天,触发紧张判定
        g.tick(240 * 0.02);
        g.state.timeOfDay = 0.99;
        g.tick(240 * 0.02);
        assert.ok(g.state.cartons.length > 0 || g.state.coins > 0, `种子 ${seed}:没有任何出路`);
        assert.ok(g.state.satisfaction >= DISTRESS.reliefSatisfaction - 1, `种子 ${seed}:满意度仍然是 ${g.state.satisfaction}`);
    }
});

test('处境艰难时事件保护:满意度见底或金币见底,不再触发要花钱应对的事件(供货商打折、下雨积水除外)', () => {
    const harmful = new Set<string>();
    for (const [coins, satisfaction] of [[500, 10], [20, 80], [5, 5]]) {
        for (let seed = 1; seed <= 25; seed++) {
            const g = newSession(seed);
            g.state.day = 9;
            g.state.level = 5;
            g.state.timeOfDay = 0.05;
            g.state.coins = coins;
            g.state.satisfaction = satisfaction;
            g.state.stock['fridge_1'] = { icecream: 10 };
            for (let i = 0; i < 6; i++) {
                g.state.eventCooldown = 0.01;
                g.tick(0.05);
                for (const e of g.state.events) if (e.type !== 'supplier_discount' && e.type !== 'rain_puddle') harmful.add(e.type);
                g.state.events = [];
                g.state.coins = coins;
            }
        }
    }
    assert.deepEqual([...harmful], []);
});

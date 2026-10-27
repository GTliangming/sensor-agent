declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { GOODS } from '../../assets/scripts/core/data/Catalog';
import { describeEvent } from '../../assets/scripts/core/events/EventSystem';
import { GameSession } from '../../assets/scripts/core/GameSession';
import { containerMismatch, maxUnitsFit, stockedUnits } from '../../assets/scripts/core/inventory/Inventory';
import { queueOf } from '../../assets/scripts/core/customers/CustomerSystem';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { newSession } from './sim-helpers';

// 自动经营机器人:只通过 GameSession 的命令玩游戏(和玩家、员工同一批命令),用来发现崩溃、数值异常和状态不一致。
// 它不追求玩得好,只做最基本的循环:进货 -> 搬运上架 -> 开门 -> 收银 -> 处理事件 -> 看日报。

const STEP = 0.5;

/** 把卸货区的纸箱全部搬进合适的货架/冷柜(或设备收进仓库)。 */
function unloadAll(g: GameSession): void {
    for (const c of g.state.cartons.filter((x) => x.location === 'door')) {
        if (g.carried) g.putDownCarton();
        if (!g.pickUpCarton(c.id).ok) continue;
        const item = GOODS.filter((x) => x.id === c.itemId)[0];
        if (!item) {
            g.storeEquipment();
            continue;
        }
        for (const f of g.layout.fixtures) {
            const carried = g.carried;
            if (!carried) break;
            if (containerMismatch(item, f) === null && maxUnitsFit(f, g.state.stock[f.id], item) > 0) g.stockContainer(f.id, 'all');
        }
        if (g.carried) g.putDownCarton();
    }
}

/** 每天早上:货架上缺的商品各进一批(钱够的话)。 */
function restock(g: GameSession): void {
    let orders = 0;
    for (const item of GOODS) {
        if (orders >= 4 || g.state.level < item.unlockLevel) continue;
        if (stockedUnits(g.state, item.id) >= 6) continue;
        if (g.state.orders.some((o) => o.itemId === item.id)) continue;
        if (!g.layout.fixtures.some((f) => containerMismatch(item, f) === null)) continue; // 没有能摆它的容器就不进货
        if (g.placeOrder(item.id, 1).ok) orders++;
    }
}

function handleEvents(g: GameSession): void {
    for (const ev of g.state.events.slice()) {
        const option = describeEvent(ev, g.state).options.filter((o) => o.id !== 'ignore' && o.cost <= g.state.coins)[0];
        if (option) g.respondEvent(ev.id, option.id);
    }
}

function playDays(g: GameSession, days: number): void {
    const target = g.state.day + days;
    let guard = 0;
    while (g.state.day < target && guard++ < 200000) {
        if (g.phase !== 'night' && !g.state.isOpen) {
            restock(g);
            g.openStore();
        }
        g.tick(STEP);
        unloadAll(g);
        const head = queueOf(g.state)[0];
        if (head) (head.scanned ? g.collectPayment(head.id) : g.scanCustomer(head.id));
        handleEvents(g);
        for (const t of g.state.trash.slice()) g.sweepTrash(t.id); // 玩家会随手打扫垃圾
        if (g.state.pendingReport) g.dismissReport();
        // 每一步都检查不变量
        assert.ok(g.state.coins >= 0, `金币变成了负数:${g.state.coins}`);
        assert.ok(g.state.satisfaction >= 0 && g.state.satisfaction <= 100, `满意度越界:${g.state.satisfaction}`);
        assert.ok(g.state.customers.length <= 6, '店里的顾客超过了上限');
    }
    assert.ok(g.state.day >= target, '机器人没能把时间推进到目标天数');
}

for (const seed of [1, 7, 42]) {
    test(`自动经营 15 天(种子 ${seed}):不崩溃,状态不变量成立,存档往返一致`, () => {
        const g = newSession(seed);
        g.state.tutorial = { step: 7, moved: true };
        playDays(g, 15);

        // 摘要输出,方便调数值时对比(不参与断言)
        console.log(`[autoplay seed=${seed}] day=${g.state.day} coins=${g.state.coins} level=${g.state.level} served=${g.state.totalServed} satisfaction=${Math.round(g.state.satisfaction)}`);
        // 基本经营成果:有人买东西、赚到钱、升过级
        assert.ok(g.state.totalServed >= 10, `15 天只服务了 ${g.state.totalServed} 位顾客`);
        assert.ok(g.state.level >= 2, `15 天后仍是 ${g.state.level} 级`);
        // 数值不能是 NaN / Infinity
        for (const v of [g.state.coins, g.state.satisfaction, g.state.xp, g.state.timeOfDay, g.state.spawnProgress]) assert.ok(Number.isFinite(v));
        // 库存不能出现负数
        for (const fid of Object.keys(g.state.stock)) for (const id of Object.keys(g.state.stock[fid])) assert.ok(g.state.stock[fid][id] > 0);
        // 存档往返后内容应完全一致(键的顺序不重要)
        const text = serializeState(g.state);
        const back: any = parseSave(text);
        assert.equal(back.kind, 'ok');
        assert.deepEqual(JSON.parse(serializeState(back.state)).state, JSON.parse(text).state);
    });
}

test('相同种子的两局经营结果完全一致(可复现)', () => {
    const run = () => {
        const g = newSession(5);
        playDays(g, 6);
        return serializeState(g.state);
    };
    assert.equal(run(), run());
});

test('自动经营时雇了员工也不会出问题:工资扣得动,收银/理货照常', () => {
    const g = newSession(3);
    g.state.level = 5;
    g.state.coins = 3000;
    g.hireStaff('cashier');
    g.hireStaff('stocker');
    playDays(g, 8);
    assert.ok(g.state.totalServed > 0);
    assert.ok(g.state.coins >= 0);
});

for (const seed of [1, 7, 42]) {
    test(`从谷底爬起来(种子 ${seed}):金币 0、满意度 0、没货,机器人 12 天内能恢复经营`, () => {
        const g = newSession(seed);
        g.state.day = 5;
        g.state.level = 2;
        g.state.coins = 0;
        g.state.satisfaction = 0;
        playDays(g, 12);
        console.log(`[recovery seed=${seed}] day=${g.state.day} coins=${g.state.coins} level=${g.state.level} served=${g.state.totalServed} satisfaction=${Math.round(g.state.satisfaction)}`);
        assert.ok(g.state.totalServed >= 15, `12 天只服务了 ${g.state.totalServed} 位顾客`);
        assert.ok(g.state.satisfaction >= 20, `满意度仍然只有 ${Math.round(g.state.satisfaction)}`);
    });
}

declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { GameSession } from '../../assets/scripts/core/GameSession';
import { LEVEL_XP, MAX_LEVEL, nextLevelXp, unlocksAtLevel } from '../../assets/scripts/core/data/Levels';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG } from '../../assets/scripts/core/time/GameClock';
import { TUTORIAL_STEP_COUNT, advanceTutorial, tutorialTarget } from '../../assets/scripts/core/tutorial/Tutorial';
import { listActions, runAction } from '../../assets/scripts/core/world/Actions';
import { resolveCircleAgainstRects } from '../../assets/scripts/core/player/Collision';
import { STREET_STORE_LAYOUT as L } from './fixtures';
import { browseSpot, queuePosition } from '../../assets/scripts/core/world/Interaction';
import { addShopper, newSession } from './sim-helpers';

const CFG = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };

test('等级阈值:逐级递增,满级没有下一级', () => {
    assert.equal(nextLevelXp(MAX_LEVEL), null);
    for (let i = 2; i <= MAX_LEVEL; i++) assert.ok(LEVEL_XP[i] > LEVEL_XP[i - 1], `第 ${i} 级门槛应递增`);
});

test('升级:发出事件并带上新解锁的商品与设备;一次经验可以连升几级', () => {
    const g = newSession();
    const ups: any[] = [];
    g.events.on('levelUp', (e) => ups.push(e));
    g.addXp(LEVEL_XP[2]);
    assert.equal(g.state.level, 2);
    assert.deepEqual(ups[0].unlocked.sort(), unlocksAtLevel(2).sort());
    assert.ok(ups[0].unlocked.indexOf('巧克力') >= 0);
    g.addXp(LEVEL_XP[4]);
    assert.equal(g.state.level, 4);
    assert.deepEqual(ups.map((u) => u.level), [2, 3, 4]);
    g.addXp(10 ** 7);
    assert.equal(g.state.level, MAX_LEVEL);
    g.addXp(-5);
    g.addXp(0);
    assert.equal(g.state.level, MAX_LEVEL);
});

test('升级后才能采购新解锁的商品', () => {
    const g = newSession();
    assert.equal((g.placeOrder('chocolate', 1) as any).code, 'locked');
    g.addXp(LEVEL_XP[2]);
    assert.equal(g.placeOrder('chocolate', 1).ok, true);
});

test('上架经验:新到货的商品每件 +1,把货拿下来再放回去不会重复得经验', () => {
    const g = newSession();
    g.placeOrder('chips', 1);
    g.expediteOrder(1);
    g.pickUpCarton(g.state.cartons[0].id);
    g.stockContainer('shelf_1', 'all'); // 12 件
    assert.equal(g.state.xp, 12);
    g.takeFromContainer('shelf_1', 'chips', 'all');
    g.stockContainer('shelf_2', 'all');
    assert.equal(g.state.xp, 12);
    // 设备入库不给经验
    g.placeOrder('equip:poster', 1);
    g.expediteOrder(2);
    g.pickUpCarton(g.state.cartons[0].id);
    g.storeEquipment();
    assert.equal(g.state.xp, 12);
});

test('日结算:跨天时生成日报(收入/接待/畅销/缺货/满意度),新的一天统计清零,看完日报才清除', () => {
    const g = newSession();
    g.state.timeOfDay = 0.9;
    g.state.stock['shelf_1'] = { chips: 10, biscuit: 10 };
    const a = addShopper(g, 'chips', 2);
    addShopper(g, 'water', 1); // 没货
    g.tick(0.2);
    g.scanCustomer(a);
    g.collectPayment(a);
    const reports: any[] = [];
    g.events.on('dayReport', (e) => reports.push(e.report));
    g.tick(240 * 0.12); // 越过午夜
    assert.equal(g.state.day, 2);
    assert.equal(reports.length, 1);
    const r = g.state.pendingReport!;
    assert.equal(r.day, 1);
    assert.equal(r.revenue, 10);
    assert.equal(r.served, 1);
    assert.equal(r.lost, 1);
    assert.equal(r.soldUnits, 2);
    assert.equal(r.bestSeller, 'chips');
    assert.deepEqual(r.missed, ['water']);
    assert.equal(g.state.today.day, 2);
    assert.equal(g.state.today.revenue, 0);
    assert.equal(g.state.today.satisfactionStart, g.state.satisfaction);
    g.dismissReport();
    assert.equal(g.state.pendingReport, null);
});

test('新手引导走完整个流程;每一步的条件由游戏状态推导', () => {
    const s = createInitialState(3);
    const g = new GameSession(s, CFG);
    const steps: number[] = [];
    g.events.on('tutorialAdvanced', (e) => steps.push(e.step));
    g.tick(0.1);
    assert.equal(s.tutorial.step, 0);
    g.reportMoved();
    assert.equal(s.tutorial.step, 1); // 走动 -> 去电脑
    g.placeOrder('equip:poster', 1); // 只买设备不算"买了第一批货"
    g.tick(0.1);
    assert.equal(s.tutorial.step, 1);
    g.placeOrder('chips', 1);
    g.tick(0.1);
    assert.equal(s.tutorial.step, 2); // 等货车
    g.expediteOrder(2);
    g.tick(0.1);
    assert.equal(s.tutorial.step, 3); // 搬箱子
    g.pickUpCarton(g.state.cartons.filter((c) => c.itemId === 'chips')[0].id);
    g.stockContainer('shelf_1', 'all');
    g.tick(0.1);
    assert.equal(s.tutorial.step, 4); // 开门
    g.openStore();
    g.tick(0.1);
    assert.equal(s.tutorial.step, 5); // 接待顾客
    const id = addShopper(g, 'chips', 1);
    g.tick(0.2);
    g.scanCustomer(id);
    g.collectPayment(id);
    g.tick(0.1);
    assert.equal(s.tutorial.step, 6); // 看面板:需要玩家确认,不会自动过
    g.tick(5);
    assert.equal(s.tutorial.step, 6);
    assert.equal(g.acknowledgeTutorial().ok, true);
    assert.equal(s.tutorial.step, TUTORIAL_STEP_COUNT);
    assert.equal(g.acknowledgeTutorial().ok, false);
    assert.deepEqual(steps, [1, 2, 3, 4, 5, 6, 7]);
});

test('引导提示的高亮地点:电脑 / 卸货区 / 收银台', () => {
    const s = createInitialState();
    const pc = L.fixtures.filter((f) => f.kind === 'computer')[0];
    const counter = L.fixtures.filter((f) => f.kind === 'counter')[0];
    s.tutorial.step = 1;
    assert.deepEqual(tutorialTarget(s, L), { x: pc.x, z: pc.z });
    s.tutorial.step = 3;
    assert.deepEqual(tutorialTarget(s, L), { x: L.unloadZone.x, z: L.unloadZone.z });
    s.tutorial.step = 5;
    assert.deepEqual(tutorialTarget(s, L), { x: counter.x, z: counter.z });
    s.tutorial.step = 0;
    assert.equal(tutorialTarget(s, L), null);
    assert.deepEqual(advanceTutorial(createInitialState()), []);
});

test('收银台旁的动作:有队首顾客时给出"扫码",扫码后变成"收款",都能执行', () => {
    const g = newSession();
    g.state.stock['shelf_1'] = { chips: 3 };
    addShopper(g, 'chips', 1);
    g.tick(0.2);
    const near = { x: 3.6, z: 3.4 }; // 收银台南侧(玩家站的位置)
    assert.deepEqual(listActions(g.state, L, near.x, near.z).map((a) => a.type), ['scan']);
    assert.equal(runAction(g, listActions(g.state, L, near.x, near.z)[0]).ok, true);
    const next = listActions(g.state, L, near.x, near.z)[0];
    assert.equal(next.type, 'collect');
    assert.ok(next.label.includes('+5'), next.label);
    assert.equal(runAction(g, next).ok, true);
    assert.deepEqual(listActions(g.state, L, near.x, near.z), []);
});

test('排队位置与逛店位置都在店内空地上(不在墙或货架里),队首最靠近收银台', () => {
    const obstacles = [...L.walls, ...L.fixtures];
    const free = (p: { x: number; z: number }) => {
        const r = resolveCircleAgainstRects(p.x, p.z, 0.25, obstacles);
        return Math.abs(r.x - p.x) < 1e-9 && Math.abs(r.z - p.z) < 1e-9;
    };
    for (let i = 0; i < 5; i++) {
        const p = queuePosition(L, i);
        assert.ok(free(p), `排队位 ${i} (${p.x}, ${p.z}) 被占用`);
        assert.ok(p.x > -6 && p.x < 6 && p.z > -4 && p.z < 4);
    }
    assert.ok(queuePosition(L, 0).z > queuePosition(L, 4).z);
    for (let id = 1; id <= 40; id++) {
        for (let round = 0; round < 4; round++) {
            const p = browseSpot(L, id, round);
            assert.ok(free(p), `逛店位 id=${id} round=${round} (${p.x}, ${p.z}) 被占用`);
        }
    }
});

test('存档 v4 往返(含顾客、统计、日报、引导进度)与 v3 迁移', () => {
    const g = newSession(9);
    g.state.stock['shelf_1'] = { chips: 5 };
    addShopper(g, 'chips', 2);
    g.tick(0.2);
    g.state.pendingReport = {
        day: 1, revenue: 20, served: 2, lost: 0, soldUnits: 4, bestSeller: 'chips', missed: ['water'], satisfactionStart: 60, satisfactionEnd: 62,
    };
    g.state.xp = 130;
    const r: any = parseSave(serializeState(g.state));
    assert.equal(r.kind, 'ok');
    assert.deepEqual(r.state, g.state);

    const v3 = JSON.stringify({
        schema_version: 3,
        state: {
            coins: 80, satisfaction: 70, level: 3, day: 4, timeOfDay: 0.3, isOpen: false,
            orders: [], nextOrderId: 1, cartons: [], nextCartonId: 1, stock: { shelf_1: { chips: 3 } }, warehouse: {},
        },
    });
    const m: any = parseSave(v3);
    assert.equal(m.kind, 'ok');
    assert.equal(m.state.xp, LEVEL_XP[3]);
    assert.equal(m.state.tutorial.step, TUTORIAL_STEP_COUNT); // 玩过的存档不再强制引导
    assert.equal(m.state.today.day, 4);

    const fresh: any = parseSave(JSON.stringify({ schema_version: 3, state: { coins: 500, satisfaction: 60, level: 1, day: 1, timeOfDay: 0, isOpen: false, orders: [], nextOrderId: 1, cartons: [], nextCartonId: 1, stock: {}, warehouse: {} } }));
    assert.equal(fresh.state.tutorial.step, 0); // 全新的存档仍然要引导
});

test('存档校验:顾客/统计/引导字段非法判为 corrupt', () => {
    const g = newSession(9);
    g.state.stock['shelf_1'] = { chips: 5 };
    addShopper(g, 'chips', 1);
    g.tick(0.2);
    const bad = (mut: (o: any) => void) => {
        const o = JSON.parse(serializeState(g.state));
        mut(o);
        return parseSave(JSON.stringify(o)).kind;
    };
    assert.equal(bad((o) => (o.state.customers[0].phase = 'dancing')), 'corrupt');
    assert.equal(bad((o) => (o.state.customers[0].cart[0].units = 0)), 'corrupt');
    assert.equal(bad((o) => (o.state.tutorial.step = 99)), 'corrupt');
    assert.equal(bad((o) => (o.state.today.revenue = -1)), 'corrupt');
    assert.equal(bad((o) => (o.state.rngState = 1.5)), 'corrupt');
    assert.equal(bad((o) => (o.state.pendingReport = { day: 1 })), 'corrupt');
    assert.equal(bad((o) => delete o.state.xp), 'corrupt');
});

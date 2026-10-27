declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { THEMES, getTheme } from '../../assets/scripts/core/data/Catalog';
import { TRASH } from '../../assets/scripts/core/data/Balance';
import { listActions, runAction } from '../../assets/scripts/core/world/Actions';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { distanceToRect } from '../../assets/scripts/core/world/Interaction';
import { initialFixtures, obstaclesOf } from '../../assets/scripts/core/world/StoreLayout';
import { STREET_STORE_LAYOUT as L } from './fixtures';
import { addShopper, newSession } from './sim-helpers';

test('主题:默认主题免费且已解锁;其余需要等级,解锁后才能切换', () => {
    const g = newSession();
    assert.equal(g.state.theme, 'street');
    assert.deepEqual(g.state.unlockedThemes, ['street']);
    assert.equal((g.setTheme('japan') as any).code, 'locked'); // 没解锁不能用
    assert.equal(g.unlockTheme('japan').ok, true); // japan 要求 1 级
    assert.equal((g.unlockTheme('japan') as any).code, 'state'); // 重复解锁
    assert.equal((g.unlockTheme('cyber') as any).code, 'locked'); // 要求 5 级
    assert.equal((g.unlockTheme('nope') as any).code, 'invalid');
    const v0 = g.layoutVersion;
    assert.equal(g.setTheme('japan').ok, true);
    assert.equal(g.state.theme, 'japan');
    assert.equal(g.layoutVersion, v0 + 1);
    assert.equal((g.setTheme('japan') as any).code, 'state');
    g.state.level = 5;
    assert.equal(g.unlockTheme('cyber').ok, true);
});

test('主题数据:id 唯一、颜色合法、getTheme 找不到时回到默认', () => {
    const ids = THEMES.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(THEMES.filter((t) => t.free).length, 1);
    for (const t of THEMES) for (const c of [...t.wall, ...t.floor, ...t.accent]) assert.ok(c >= 0 && c <= 255, t.id);
    assert.equal(getTheme('nope').id, 'street');
});

test('垃圾:收银后有概率留在店内空地上,数量有上限;不会落在设施里和店门口', () => {
    const g = newSession(3);
    g.state.stock['shelf_1'] = { chips: 500 };
    for (let i = 0; i < 60; i++) {
        addShopper(g, 'chips', 1);
        g.tick(0.2);
        const c = g.state.customers[0];
        g.scanCustomer(c.id);
        g.collectPayment(c.id);
    }
    assert.ok(g.state.trash.length > 0, '60 位顾客一处垃圾都没有');
    assert.ok(g.state.trash.length <= TRASH.max);
    const blockers = obstaclesOf(L);
    for (const t of g.state.trash) {
        assert.ok(blockers.every((r) => distanceToRect(t.x, t.z, r) >= 0.5), `垃圾 ${t.id} 压在设施上`);
        assert.ok(Math.hypot(t.x, t.z - 3.4) >= 0.9);
    }
    const ids = g.state.trash.map((t) => t.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('清扫垃圾:动作出现在垃圾旁,执行后垃圾消失', () => {
    const g = newSession();
    g.state.trash = [{ id: 1, x: -1, z: 0 }];
    g.state.nextTrashId = 2;
    const far = listActions(g.state, L, 5, 0.5).map((a) => a.type);
    assert.equal(far.indexOf('sweep'), -1);
    const acts = listActions(g.state, L, -1, 0.5);
    assert.equal(acts[0].type, 'sweep');
    assert.equal(runAction(g, acts[0]).ok, true);
    assert.equal(g.state.trash.length, 0);
    assert.equal((g.sweepTrash(1) as any).code, 'invalid');
});

test('垃圾堆多了,开门营业时满意度缓慢下降;不超过 2 处或没开门不受影响', () => {
    const mk = (n: number, open: boolean) => {
        const g = newSession();
        g.state.timeOfDay = 0.1;
        g.state.satisfaction = 20; // 低满意度时客流极少,20 秒内不会来人,排除顾客对满意度的干扰
        if (open) g.openStore();
        g.state.trash = Array.from({ length: n }, (_, i) => ({ id: i + 1, x: -4 + i * 0.1, z: 0 }));
        g.state.nextTrashId = n + 1;
        g.state.spawnProgress = 0;
        for (let i = 0; i < 20; i++) g.tick(1);
        return g.state.satisfaction;
    };
    assert.equal(mk(2, true), 20);
    assert.equal(mk(8, false), 20);
    assert.ok(mk(8, true) < 19.9, `满意度 ${mk(8, true)}`);
});

test('存档 v5:摆放的设施、扩建、主题、垃圾往返一致', () => {
    const g = newSession(4);
    g.state.warehouse['poster'] = 1;
    g.placeFixture('poster', 0, 0.5, 0);
    g.state.warehouse['shelf'] = 1;
    g.placeFixture('shelf', -3, 0.5, 0);
    g.state.expansion = 1;
    g.state.unlockedThemes = ['street', 'japan'];
    g.state.theme = 'japan';
    g.state.trash = [{ id: 3, x: 1.5, z: 0.5 }];
    g.state.nextTrashId = 4;
    const r: any = parseSave(serializeState(g.state));
    assert.equal(r.kind, 'ok');
    assert.deepEqual(r.state, g.state);
});

test('存档 v4 迁移到 v5:使用初始设施、扩建 0 级、默认主题', () => {
    const g = newSession();
    const v4 = JSON.parse(serializeState(g.state));
    v4.schema_version = 4;
    for (const k of ['fixtures', 'nextFixtureId', 'expansion', 'theme', 'unlockedThemes', 'trash', 'nextTrashId']) delete v4.state[k];
    const m: any = parseSave(JSON.stringify(v4));
    assert.equal(m.kind, 'ok');
    assert.deepEqual(m.state.fixtures, initialFixtures());
    assert.equal(m.state.expansion, 0);
    assert.equal(m.state.theme, 'street');
    assert.deepEqual(m.state.trash, []);
});

test('存档校验:设施/扩建/主题异常的处理', () => {
    const g = newSession();
    const edit = (mut: (o: any) => void) => {
        const o = JSON.parse(serializeState(g.state));
        mut(o);
        return parseSave(JSON.stringify(o));
    };
    assert.equal(edit((o) => (o.state.fixtures = o.state.fixtures.filter((f: any) => f.kind !== 'counter'))).kind, 'corrupt');
    assert.equal(edit((o) => o.state.fixtures.push({ ...o.state.fixtures[0] })).kind, 'corrupt'); // id 重复
    assert.equal(edit((o) => (o.state.fixtures[0].front = { x: 1, z: 1 })).kind, 'corrupt');
    assert.equal(edit((o) => (o.state.fixtures[0].w = 0)).kind, 'corrupt');
    assert.equal(edit((o) => (o.state.expansion = 9)).kind, 'corrupt');
    assert.equal(edit((o) => (o.state.trash = [{ id: 1 }])).kind, 'corrupt');
    // 主题异常不判损坏,而是回到默认
    const m: any = edit((o) => {
        o.state.unlockedThemes = ['japan', 'gone_theme'];
        o.state.theme = 'cyber';
    });
    assert.equal(m.kind, 'ok');
    assert.deepEqual(m.state.unlockedThemes, ['street', 'japan']);
    assert.equal(m.state.theme, 'street');
    // 设施序号归一化,避免新 id 重复
    const n: any = edit((o) => {
        o.state.fixtures.push({ ...o.state.fixtures[0], id: 'shelf_n9', x: 100 });
        o.state.nextFixtureId = 1;
    });
    assert.equal(n.state.nextFixtureId, 10);
});

declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { GameSession } from '../../assets/scripts/core/GameSession';
import { createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG } from '../../assets/scripts/core/time/GameClock';

// 固定一天 240 秒,测试不依赖默认配置里可能被临时改小的数值
const CFG = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };

/** 把状态定位到某个游戏内小时。 */
function sessionAt(hour: number, isOpen = false): GameSession {
    const s = createInitialState();
    s.timeOfDay = (hour - 6) / 18;
    s.isOpen = isOpen;
    return new GameSession(s, CFG);
}

test('白天可以开门、打烊,重复操作给出原因', () => {
    const g = sessionAt(8);
    assert.deepEqual(g.openStore(), { ok: true });
    assert.equal(g.state.isOpen, true);
    const again = g.openStore();
    assert.equal(again.ok, false);
    assert.deepEqual(g.closeStore(), { ok: true });
    assert.equal(g.closeStore().ok, false);
});

test('夜间不能开门', () => {
    const g = sessionAt(21);
    const r = g.openStore();
    assert.equal(r.ok, false);
    assert.equal(g.state.isOpen, false);
});

test('营业中到了夜间会自动打烊并发出事件', () => {
    const g = sessionAt(18.9, true);
    const events: string[] = [];
    g.events.on('storeOpenChanged', (e) => events.push(`${e.isOpen}:${e.reason}`));
    g.events.on('phaseChanged', (e) => events.push(`phase:${e.previous}->${e.phase}`));
    g.tick(240 * (0.2 / 18)); // 推进 0.2 个游戏小时
    assert.equal(g.state.isOpen, false);
    assert.deepEqual(events, ['phase:evening->night', 'false:nightfall']);
});

test('过完一天:天数 +1,回到清晨,店铺保持打烊', () => {
    const g = sessionAt(23.9, false);
    const days: number[] = [];
    g.events.on('dayChanged', (e) => days.push(e.day));
    g.tick(240 * (0.3 / 18));
    assert.equal(g.state.day, 2);
    assert.deepEqual(days, [2]);
    assert.equal(g.phase, 'morning');
    assert.equal(g.state.isOpen, false);
});

test('读档时夜间的营业状态被归一化为打烊', () => {
    const g = sessionAt(22, true);
    assert.equal(g.state.isOpen, false);
});

test('非法或零的 dt 被忽略', () => {
    const g = sessionAt(8);
    const t = g.state.timeOfDay;
    g.tick(0);
    g.tick(-5);
    g.tick(NaN);
    assert.equal(g.state.timeOfDay, t);
});

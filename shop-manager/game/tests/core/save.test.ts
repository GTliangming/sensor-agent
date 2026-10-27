declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { MemoryStorage } from './fixtures';
import { SaveManager, parseSave, serializeState, SAVE_SCHEMA_VERSION } from '../../assets/scripts/core/save/SaveGame';
import { createInitialState } from '../../assets/scripts/core/state/GameState';

test('存档往返:写入再读出,状态完全一致', () => {
    const m = new SaveManager(new MemoryStorage());
    const s = { ...createInitialState(), coins: 1234, day: 7, timeOfDay: 0.42, isOpen: true };
    assert.equal(m.save(s), true);
    const r = m.load();
    assert.equal(r.kind, 'ok');
    assert.deepEqual((r as any).state, s);
});

test('没有存档时返回 empty', () => {
    assert.equal(new SaveManager(new MemoryStorage()).load().kind, 'empty');
});

test('损坏的存档:返回 corrupt,保留备份,主存档被清掉可重新开局', () => {
    const st = new MemoryStorage();
    st.setItem('shop-manager.save', '{不是json');
    const m = new SaveManager(st);
    assert.equal(m.load().kind, 'corrupt');
    assert.equal(st.getItem('shop-manager.save.corrupt'), '{不是json');
    assert.equal(st.getItem('shop-manager.save'), null);
    assert.equal(m.save(createInitialState()), true);
});

test('字段缺失或类型错误都判为 corrupt', () => {
    const base = JSON.parse(serializeState(createInitialState()));
    const bad = (mut: (o: any) => void) => {
        const o = JSON.parse(JSON.stringify(base));
        mut(o);
        return parseSave(JSON.stringify(o)).kind;
    };
    assert.equal(bad((o) => delete o.state.coins), 'corrupt');
    assert.equal(bad((o) => (o.state.day = 0)), 'corrupt');
    assert.equal(bad((o) => (o.state.timeOfDay = 1)), 'corrupt');
    assert.equal(bad((o) => (o.state.isOpen = 'yes')), 'corrupt');
    assert.equal(bad((o) => delete o.schema_version), 'corrupt');
});

test('满意度超出范围会被限制在 0~100', () => {
    const o = JSON.parse(serializeState(createInitialState()));
    o.state.satisfaction = 250;
    const r = parseSave(JSON.stringify(o));
    assert.equal((r as any).state.satisfaction, 100);
});

test('来自更新版本的存档:返回 tooNew,且不会被覆盖', () => {
    const st = new MemoryStorage();
    const future = JSON.stringify({ schema_version: SAVE_SCHEMA_VERSION + 1, state: {} });
    st.setItem('shop-manager.save', future);
    const m = new SaveManager(st);
    assert.equal(m.load().kind, 'tooNew');
    assert.equal(m.save(createInitialState()), false);
    assert.equal(st.getItem('shop-manager.save'), future);
});

test('存储写入抛异常时 save 返回 false 而不是崩溃', () => {
    const st = new MemoryStorage();
    st.setItem = () => {
        throw new Error('quota');
    };
    assert.equal(new SaveManager(st).save(createInitialState()), false);
});

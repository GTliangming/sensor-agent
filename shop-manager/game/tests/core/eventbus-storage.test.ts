declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { EventBus } from '../../assets/scripts/core/base/EventBus';
import { MemoryStorage } from './fixtures';
import { SaveManager, parseSave } from '../../assets/scripts/core/save/SaveGame';

test('空字符串和 undefined 都当作"没有存档"(微信存储对不存在的 key 返回空串)', () => {
    assert.equal(parseSave('').kind, 'empty');
    assert.equal(parseSave(undefined).kind, 'empty');
    const st = new MemoryStorage();
    st.setItem('shop-manager.save', '');
    const m = new SaveManager(st);
    assert.equal(m.load().kind, 'empty');
    assert.equal(st.getItem('shop-manager.save.corrupt'), null);
});

test('EventBus:多个订阅者按顺序收到事件', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const got: string[] = [];
    bus.on('ping', (e) => got.push(`a${e.n}`));
    bus.on('ping', (e) => got.push(`b${e.n}`));
    bus.emit('ping', { n: 1 });
    assert.deepEqual(got, ['a1', 'b1']);
});

test('EventBus:取消订阅生效,且可以在处理函数里取消自己', () => {
    const bus = new EventBus<{ ping: number }>();
    const got: string[] = [];
    const offA = bus.on('ping', () => got.push('a'));
    const offSelf = bus.on('ping', () => {
        got.push('self');
        offSelf();
    });
    bus.on('ping', () => got.push('c'));
    bus.emit('ping', 1);
    bus.emit('ping', 2);
    offA();
    bus.emit('ping', 3);
    assert.deepEqual(got, ['a', 'self', 'c', 'a', 'c', 'c']);
});

test('EventBus:没有订阅者时 emit 不报错', () => {
    new EventBus<{ x: number }>().emit('x', 1);
});

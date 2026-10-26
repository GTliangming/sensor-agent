declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { makePlayer, run, FORWARD, BACKWARD } from './helpers';

test('向前走会被货架挡住,停在货架前一个半径处', () => {
    const p = makePlayer(0, 0.5, 0); // 正对 shelf_2(z 范围 -2.5..-1.9)
    run(p, FORWARD, 3);
    assert.ok(Math.abs(p.z - (-1.9 + p.radius)) < 0.01, `z=${p.z}`);
});

test('斜着顶向货架会沿货架滑动而不是卡死或穿过', () => {
    const p = makePlayer(-0.2, 0.5, -20); // 略向右转:前进方向偏向 +x
    run(p, FORWARD, 1.5);
    assert.ok(p.x > 0.3, `应沿货架向右滑动,x=${p.x}`);
    assert.ok(p.z >= -1.9 + p.radius - 0.01, `不应穿过货架,z=${p.z}`);
});

test('被北墙挡住', () => {
    const p = makePlayer(-5, 0, 0); // x=-5 处没有货架
    run(p, FORWARD, 5);
    assert.ok(Math.abs(p.z - (-4 + p.radius)) < 0.01, `z=${p.z}`);
});

test('不能从门洞以外的位置穿过南墙', () => {
    const p = makePlayer(-3, 3, 0);
    run(p, BACKWARD, 3); // 向后走 = +z
    assert.ok(Math.abs(p.z - (4 - p.radius)) < 0.01, `z=${p.z}`);
});

test('能从正对门洞的位置走出店门到街上', () => {
    const p = makePlayer(0, 2.8, 0);
    run(p, BACKWARD, 3);
    assert.ok(p.z > 5, `应已在店外,z=${p.z}`);
    assert.ok(Math.abs(p.x) < 0.01, `x=${p.x}`);
});

test('走到世界边界会被拦住', () => {
    const p = makePlayer(0, 2.8, 0);
    run(p, BACKWARD, 20);
    assert.ok(Math.abs(p.z - (14 - p.radius)) < 0.01, `z=${p.z}`);
});

test('能从街上再走回店内', () => {
    const p = makePlayer(0, 8, 0);
    run(p, FORWARD, 3);
    assert.ok(p.z < 3, `应已进店,z=${p.z}`);
});

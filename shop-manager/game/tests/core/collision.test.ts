declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { resolveCircleAgainstRects, clampCircleInRect } from '../../assets/scripts/core/player/Collision';

const box = { x: 0, z: 0, w: 2, d: 2 }; // x:[-1,1] z:[-1,1]

test('圆不与矩形相交时位置不变', () => {
    const p = resolveCircleAgainstRects(3, 0, 0.3, [box]);
    assert.deepEqual(p, { x: 3, z: 0 });
});

test('圆从左侧压进矩形时被推回到表面外', () => {
    const p = resolveCircleAgainstRects(-1.1, 0, 0.3, [box]);
    assert.ok(Math.abs(p.x - -1.3) < 1e-9, `x=${p.x}`);
    assert.equal(p.z, 0);
});

test('圆心落在矩形内部时朝最近的边推出', () => {
    const p = resolveCircleAgainstRects(0.8, 0, 0.3, [box]); // 离右边最近
    assert.ok(Math.abs(p.x - 1.3) < 1e-9, `x=${p.x}`);
});

test('贴着矩形角落时沿对角方向推出且距离等于半径', () => {
    const p = resolveCircleAgainstRects(1.1, 1.1, 0.3, [box]);
    const dist = Math.hypot(p.x - 1, p.z - 1);
    assert.ok(Math.abs(dist - 0.3) < 1e-9, `dist=${dist}`);
});

test('clampCircleInRect 把圆限制在范围内', () => {
    const bounds = { x: 0, z: 0, w: 10, d: 10 };
    assert.deepEqual(clampCircleInRect(99, -99, 0.5, bounds), { x: 4.5, z: -4.5 });
});

declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { PlayerMotion } from '../../assets/scripts/core/player/PlayerMotion';
import { makePlayer, run, FORWARD, RIGHT } from './helpers';

const open = { x: 0, z: 0, w: 200, d: 200 };
const near = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

test('yaw=0 时向前走 = z 减小,向右走 = x 增大', () => {
    const p = makePlayer(0, 0.5, 0);
    run(p, FORWARD, 0.2);
    assert.ok(p.z < 0.5 && near(p.x, 0));
    const q = makePlayer(0, 0.5, 0);
    run(q, RIGHT, 0.2);
    assert.ok(q.x > 0 && near(q.z, 0.5));
});

test('左转 90 度后向前走 = x 减小', () => {
    const p = makePlayer(0, 0.5, 0);
    p.turn(90, 0);
    run(p, FORWARD, 0.2);
    assert.ok(p.x < 0 && near(p.z, 0.5));
});

test('斜向移动速度不超过直行速度', () => {
    const p = new PlayerMotion({ x: 0, z: 0, yawDeg: 0 }, { bounds: open, obstacles: [] });
    run(p, { moveX: 1, moveY: 1 }, 1);
    assert.ok(near(Math.hypot(p.x, p.z), p.speed, 0.05), `位移 ${Math.hypot(p.x, p.z)}`);
});

test('超大 dt(卡顿)不会让玩家一步穿墙', () => {
    const p = makePlayer(-3, 3.5, 180); // 面朝 +z,正对南墙
    for (let i = 0; i < 10; i++) p.step(FORWARD, 5);
    assert.ok(p.z <= 4 - p.radius + 1e-9, `z=${p.z}`);
});

test('俯仰角被限幅,水平角回绕到 0..360', () => {
    const p = makePlayer();
    p.turn(0, 500);
    assert.equal(p.pitchDeg, p.pitchLimitDeg);
    p.turn(0, -1000);
    assert.equal(p.pitchDeg, -p.pitchLimitDeg);
    p.turn(-10, 0);
    assert.ok(p.yawDeg >= 0 && p.yawDeg < 360 && near(p.yawDeg, 350, 1e-9));
});

test('没有输入时位置不变', () => {
    const p = makePlayer();
    const { x, z } = p;
    run(p, { moveX: 0, moveY: 0 }, 1);
    assert.deepEqual({ x: p.x, z: p.z }, { x, z });
});

declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { STREET_STORE_LAYOUT as L } from './fixtures';
import { resolveCircleAgainstRects } from '../../assets/scripts/core/player/Collision';

const overlaps = (a: any, b: any) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.z - b.z) < (a.d + b.d) / 2;

test('出生点不在任何障碍里,且离障碍有一个半径的空隙', () => {
    const obstacles = [...L.walls, ...L.fixtures];
    const p = resolveCircleAgainstRects(L.spawn.x, L.spawn.z, 0.3, obstacles);
    assert.deepEqual(p, { x: L.spawn.x, z: L.spawn.z });
});

test('店内设施彼此不重叠,也不与墙重叠', () => {
    const all = [...L.walls, ...L.fixtures];
    for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
            assert.ok(!overlaps(all[i], all[j]), `第 ${i} 项与第 ${j} 项重叠`);
        }
    }
});

test('设施 id 唯一', () => {
    const ids = L.fixtures.map((f) => f.id);
    assert.equal(new Set(ids).size, ids.length);
});

test('门洞宽度足够玩家(直径 0.6 米)通过', () => {
    const south = L.walls.filter((w) => Math.abs(w.z - 4.1) < 1e-9);
    assert.equal(south.length, 2);
    const left = south.find((w) => w.x < 0)!;
    const right = south.find((w) => w.x > 0)!;
    const gap = right.x - right.w / 2 - (left.x + left.w / 2);
    assert.ok(gap >= 0.6 + 0.2, `门洞宽 ${gap}`);
});

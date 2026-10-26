declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { DEFAULT_CLOCK_CONFIG, advanceTime, formatClock, hourAt, phaseAt } from '../../assets/scripts/core/time/GameClock';
import { lightingAt } from '../../assets/scripts/core/time/DayCycle';

test('一天从 06:00 开始,各时段边界正确', () => {
    assert.equal(formatClock(0), '06:00');
    assert.equal(phaseAt(0), 'morning');
    const at = (hour: number) => (hour - 6) / 18; // 小时 -> timeOfDay
    assert.equal(phaseAt(at(10.99)), 'morning');
    assert.equal(phaseAt(at(11)), 'noon');
    assert.equal(phaseAt(at(15.99)), 'noon');
    assert.equal(phaseAt(at(16)), 'evening');
    assert.equal(phaseAt(at(19)), 'night');
    assert.equal(phaseAt(0.9999), 'night');
});

test('时间格式化', () => {
    assert.equal(formatClock(0.5), '15:00');
    assert.equal(formatClock(0.9999), '23:59');
    assert.ok(Math.abs(hourAt(1) - 24) < 1e-9);
});

test('advanceTime 跨天回绕并返回天数', () => {
    // 测试用固定配置,不依赖 DEFAULT_CLOCK_CONFIG 里可能被临时改小的 dayLengthSec
    const cfg = { ...DEFAULT_CLOCK_CONFIG, dayLengthSec: 240 };
    const r = advanceTime(0.9, 24, cfg);
    assert.equal(r.daysPassed, 1);
    assert.ok(Math.abs(r.timeOfDay - 0) < 1e-9, `t=${r.timeOfDay}`);
    const big = advanceTime(0, 240 * 3 + 120, cfg);
    assert.equal(big.daysPassed, 3);
    assert.ok(Math.abs(big.timeOfDay - 0.5) < 1e-9);
});

test('光照曲线:连续、强度在 0.3~1', () => {
    let prev = lightingAt(6);
    for (let h = 6; h <= 24; h += 0.05) {
        const l = lightingAt(h);
        assert.ok(l.intensity >= 0.3 - 1e-9 && l.intensity <= 1 + 1e-9, `h=${h} intensity=${l.intensity}`);
        assert.ok(Math.abs(l.intensity - prev.intensity) < 0.1, `h=${h} 强度突变`);
        for (let i = 0; i < 3; i++) {
            assert.ok(Math.abs(l.skyColor[i] - prev.skyColor[i]) < 40, `h=${h} 天空色突变`);
        }
        prev = l;
    }
    assert.ok(lightingAt(12).intensity > lightingAt(22).intensity);
});

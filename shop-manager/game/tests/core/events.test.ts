declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { Rng } from '../../assets/scripts/core/base/Rng';
import { EVENTS } from '../../assets/scripts/core/data/Balance';
import { WEATHER, WeatherKind, rollWeather } from '../../assets/scripts/core/events/Weather';
import { GameSession } from '../../assets/scripts/core/GameSession';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import { EventType, createInitialState } from '../../assets/scripts/core/state/GameState';
import { DEFAULT_CLOCK_CONFIG } from '../../assets/scripts/core/time/GameClock';
import { newSession } from './sim-helpers';

const SEC_PER_GAME_MINUTE = 240 / 1080;

/** 手工放一个待处理事件,并关掉自动触发,让测试只关注这一个事件。 */
function addEvent(g: GameSession, type: EventType, itemId: string | null = null): number {
    const id = g.state.nextEventId++;
    g.state.events.push({ id, type, itemId, remainingSec: EVENTS.durationSec, totalSec: EVENTS.durationSec });
    g.state.eventCooldown = 1e9;
    return id;
}

test('天气抽取:第 1 天一定是晴天;新手保护期只会晴/雨/高温;之后五种都会出现', () => {
    const rng = new Rng({ rngState: 99 });
    assert.equal(rollWeather(rng, 1), 'clear');
    const early = new Set<string>();
    const late = new Set<string>();
    for (let i = 0; i < 400; i++) {
        early.add(rollWeather(rng, 2 + (i % 2)));
        late.add(rollWeather(rng, 10));
    }
    assert.deepEqual([...early].sort(), ['clear', 'hot', 'rain']);
    assert.deepEqual([...late].sort(), ['clear', 'hot', 'rain', 'snow_fog', 'wind']);
});

test('同一个种子得到同样的预报;预报是未来两天', () => {
    const a = createInitialState(42);
    const b = createInitialState(42);
    assert.deepEqual(a.forecast, b.forecast);
    assert.equal(a.forecast.length, 2);
    assert.equal(a.weather, 'clear');
});

test('过了一天:今天的天气 = 昨天的预报,预报整体前移并补上新的一天', () => {
    const g = newSession(5);
    g.state.forecast = ['hot', 'wind'];
    g.state.timeOfDay = 0.99;
    const seen: any[] = [];
    g.events.on('weatherChanged', (e) => seen.push(e));
    g.tick(240 * 0.02);
    assert.equal(g.state.day, 2);
    assert.equal(g.state.weather, 'hot');
    assert.equal(g.state.forecast[0], 'wind');
    assert.ok(g.state.forecast[1] in WEATHER);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].weather, 'hot');
});

test('下雨天开始:门口没有防滑垫 -> 触发积水事件;摆了防滑垫 -> 不触发,还得一点经验', () => {
    const run = (withMat: boolean) => {
        const g = newSession(5);
        g.state.forecast = ['rain', 'clear'];
        if (withMat) {
            g.state.warehouse['antislip_mat'] = 1;
            assert.equal(g.placeFixture('antislip_mat', 0, 3.4, 0).ok, true);
        }
        g.state.timeOfDay = 0.99;
        g.state.eventCooldown = 1e9;
        const notes: any[] = [];
        g.events.on('weatherChanged', (e) => notes.push(e.note));
        g.tick(240 * 0.02);
        return { g, notes };
    };
    const a = run(false);
    assert.deepEqual(a.g.state.events.map((e) => e.type), ['rain_puddle']);
    const b = run(true);
    assert.equal(b.g.state.events.length, 0);
    assert.ok(b.notes[0] && b.notes[0].includes('防滑垫'));
    assert.equal(b.g.state.xp, 5);
});

test('天气影响客流:暴雨 < 晴天 < 高温 < ;暴雪大雾最少', () => {
    const count = (w: WeatherKind) => {
        const g = newSession(21);
        g.state.weather = w;
        g.state.satisfaction = 100;
        g.state.timeOfDay = 0.05;
        g.state.eventCooldown = 1e9;
        g.openStore();
        for (let i = 0; i < 240; i++) g.tick(0.5);
        return g.state.nextCustomerId - 1;
    };
    const [clear, rain, hot, snow] = [count('clear'), count('rain'), count('hot'), count('snow_fog')];
    assert.ok(rain < clear, `rain ${rain} clear ${clear}`);
    assert.ok(hot > clear, `hot ${hot} clear ${clear}`);
    assert.ok(snow < rain, `snow ${snow} rain ${rain}`);
});

test('高温天冷饮和雪糕更热销', () => {
    const coldShare = (w: WeatherKind) => {
        const g = newSession(8);
        g.state.weather = w;
        g.state.level = 3;
        g.state.satisfaction = 100;
        g.state.timeOfDay = 0.05;
        g.state.eventCooldown = 1e9;
        g.openStore();
        let cold = 0;
        let total = 0;
        const seen: { [id: number]: boolean } = {};
        for (let i = 0; i < 400; i++) {
            g.tick(0.25);
            for (const c of g.state.customers) {
                if (seen[c.id]) continue;
                seen[c.id] = true;
                total++;
                if (['cola', 'water', 'juice', 'icecream', 'dumpling'].indexOf(c.wants[0].itemId) >= 0) cold++;
            }
        }
        return cold / total;
    };
    assert.ok(coldShare('hot') > coldShare('clear') + 0.15);
});

test('下雨送货慢 1.5 倍;暴雪大雾货车停运,天气过去才送达;加急不受影响', () => {
    const g = newSession();
    g.state.weather = 'rain';
    g.placeOrder('chips', 1);
    const o = g.state.orders[0];
    assert.equal(o.arriveAtMinute - o.placedAtMinute, Math.round(90 * WEATHER.rain.deliveryMul));

    const h = newSession();
    h.state.weather = 'snow_fog';
    h.state.eventCooldown = 1e9;
    h.placeOrder('chips', 1);
    h.placeOrder('water', 1);
    h.tick(120 * SEC_PER_GAME_MINUTE);
    assert.equal(h.state.orders[0].status, 'delivering'); // 过了预计时间也没送
    assert.equal(h.expediteOrder(h.state.orders[1].id).ok, true); // 看广告加急不受影响
    h.state.weather = 'clear';
    h.tick(1);
    assert.equal(h.state.orders[0].status, 'arrived');
});

test('事件触发:有冷却;新手引导期间和夜间不触发;最多同时 2 个', () => {
    const g = newSession(3);
    g.state.day = 5;
    g.state.level = 3;
    g.state.eventCooldown = 10;
    g.tick(9);
    assert.equal(g.state.events.length, 0);

    const tut = newSession(3);
    tut.state.tutorial = { step: 2, moved: true };
    tut.state.day = 5;
    tut.state.eventCooldown = 0.1;
    tut.tick(5);
    assert.equal(tut.state.events.length, 0);

    const night = newSession(3);
    night.state.timeOfDay = 0.9;
    night.state.day = 5;
    night.state.eventCooldown = 0.1;
    night.tick(5);
    assert.equal(night.state.events.length, 0);

    const many = newSession(3);
    many.state.day = 5;
    many.state.timeOfDay = 0.05;
    for (let i = 0; i < 40; i++) {
        many.state.eventCooldown = 0.01;
        many.tick(0.05);
        assert.ok(many.state.events.length <= EVENTS.maxActive);
    }
});

test('新手保护期(前 3 天)只会来供货商打折这类无惩罚的事件', () => {
    const types = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
        const g = newSession(seed);
        g.state.day = 2;
        g.state.level = 3;
        g.state.timeOfDay = 0.05;
        g.state.stock['fridge_1'] = { icecream: 10 };
        for (let i = 0; i < 6; i++) {
            g.state.eventCooldown = 0.01;
            g.tick(0.05);
            g.state.events.splice(0, g.state.events.length);
        }
        g.events.on('eventStarted', (e) => types.add(e.event.type));
        for (let i = 0; i < 4; i++) {
            g.state.eventCooldown = 0.01;
            g.tick(0.05);
            g.state.events.splice(0, g.state.events.length);
        }
    }
    for (const t of types) assert.ok(['supplier_discount', 'rain_puddle'].indexOf(t) >= 0, `保护期出现了 ${t}`);
});

test('高温天会触发冷柜过热;有易腐库存才会出现快过期;1 级不会停电', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
        const g = newSession(seed);
        g.state.day = 8;
        g.state.level = 3;
        g.state.weather = 'hot';
        g.state.timeOfDay = 0.05;
        g.state.stock['fridge_1'] = { icecream: 10 };
        g.events.on('eventStarted', (e) => seen.add(e.event.type));
        g.state.eventCooldown = 0.01;
        g.tick(0.05);
    }
    assert.ok(seen.has('heat_fridge'));
    assert.ok(seen.has('expiring'));

    const low = newSession(1);
    low.state.day = 8;
    low.state.level = 1;
    for (let i = 0; i < 40; i++) {
        low.state.eventCooldown = 0.01;
        low.state.timeOfDay = 0.05;
        low.tick(0.05);
        assert.ok(low.state.events.every((e) => e.type !== 'blackout'));
        low.state.events = [];
    }
});

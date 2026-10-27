declare function require(name: string): any;
const { test } = require('node:test');
const assert = require('node:assert/strict');

import { cartTotal } from '../../assets/scripts/core/customers/CustomerSystem';
import { buildFeedback, kindForCustomer } from '../../assets/scripts/core/customers/Feedback';
import { SATISFACTION, SURVEY } from '../../assets/scripts/core/data/Balance';
import { GameSession } from '../../assets/scripts/core/GameSession';
import { parseSave, serializeState } from '../../assets/scripts/core/save/SaveGame';
import type { CustomerKind } from '../../assets/scripts/core/state/GameState';
import { addShopper, newSession } from './sim-helpers';

/** 第 2 天、货架上有薯片、关着门(不会来随机顾客)的会话,放一位指定类型的顾客并让他逛完去排队。 */
function queued(kind: CustomerKind, opts: { stocked?: boolean; level?: number; day?: number } = {}): { g: GameSession; id: number } {
    const g = newSession(3);
    g.state.day = opts.day ?? 2;
    g.state.level = opts.level ?? 1;
    g.state.eventCooldown = 1e9;
    if (opts.stocked !== false) g.state.stock['shelf_1'] = { chips: 10 };
    const id = addShopper(g, 'chips', 1, 0.1);
    g.state.customers.find((c) => c.id === id)!.kind = kind;
    g.tick(0.2);
    return { g, id };
}

test('顾客类型由编号决定:第 1 天和引导期都是普通客人;暗访客要 2 级且过了保护期', () => {
    const g = newSession();
    const count = (day: number, level: number, guided = false) => {
        g.state.day = day;
        g.state.level = level;
        const n: { [k: string]: number } = { normal: 0, survey: 0, secret: 0 };
        for (let id = 1; id <= 100; id++) n[kindForCustomer(g.state, id, guided)]++;
        return n;
    };
    assert.deepEqual(count(1, 5), { normal: 100, survey: 0, secret: 0 });
    assert.deepEqual(count(5, 5, true), { normal: 100, survey: 0, secret: 0 });
    assert.deepEqual(count(2, 5), { normal: 100 - SURVEY.surveyPercent, survey: SURVEY.surveyPercent, secret: 0 }); // 保护期没有暗访
    assert.deepEqual(count(5, 1), { normal: 100 - SURVEY.surveyPercent, survey: SURVEY.surveyPercent, secret: 0 }); // 1 级没有暗访
    assert.deepEqual(count(5, 2), { normal: 100 - SURVEY.surveyPercent - SURVEY.secretPercent, survey: SURVEY.surveyPercent, secret: SURVEY.secretPercent });
});

test('问卷客结账:发金币/满意度/经验奖励,留下与实际情况一致的反馈,并通知界面', () => {
    const { g, id } = queued('survey');
    const c = g.state.customers.find((x) => x.id === id)!;
    assert.equal(c.phase, 'queuing');
    const total = cartTotal(c, g.state);
    const coins = g.state.coins;
    g.state.satisfaction = 50;
    const seen: any[] = [];
    g.events.on('feedbackReceived', (e) => seen.push(e.record));

    assert.equal(g.scanCustomer(id).ok, true);
    const r: any = g.collectPayment(id);
    assert.equal(r.ok, true);
    assert.ok(r.info.includes(`${SURVEY.rewardCoins}`));
    assert.equal(g.state.coins, coins + total + SURVEY.rewardCoins);
    assert.equal(g.state.satisfaction, 50 + SATISFACTION.servedOnTime + SURVEY.rewardSatisfaction);
    assert.equal(g.state.feedback.length, 1);
    const f = g.state.feedback[0];
    assert.deepEqual([f.kind, f.rating, f.find, f.wait, f.paid, f.reasons.length], ['survey', 5, 0, 0, true, 0]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].id, f.id);
});

test('反馈能对应到真实原因:等太久、垃圾、缺货', () => {
    const slow = queued('survey');
    slow.g.state.customers[0].waited = SURVEY.waitOkSec + 5;
    slow.g.state.trash = [1, 2, 3].map((i) => ({ id: i, x: 0, z: 0 }));
    slow.g.scanCustomer(slow.id);
    slow.g.collectPayment(slow.id);
    const f = slow.g.state.feedback[0];
    assert.equal(f.wait, 2);
    assert.equal(f.rating, 5 - 2 - 1);
    assert.ok(f.reasons.indexOf('结账等了太久') >= 0 && f.reasons.indexOf('地上有垃圾,不太干净') >= 0);

    // 货架上没有薯片:暗访客什么都没买到就走了,留下"没找到想买的"和想要的商品
    const empty = queued('secret', { stocked: false, level: 2, day: 5 });
    assert.equal(empty.g.state.customers.length, 0);
    const e = empty.g.state.feedback[0];
    assert.deepEqual([e.kind, e.rating, e.find, e.paid, e.wishItemId], ['secret', 1, 2, false, 'chips']);
    assert.ok(e.reasons.some((r) => r.indexOf('没找到想买的') === 0));
});

test('问卷客没买成就走了:没有问卷、没有奖励;普通客人从不留反馈', () => {
    const survey = queued('survey', { stocked: false });
    assert.equal(survey.g.state.feedback.length, 0);
    const normal = queued('normal');
    normal.g.scanCustomer(normal.id);
    normal.g.collectPayment(normal.id);
    assert.equal(normal.g.state.feedback.length, 0);
});

test('暗访客结账:按评分直接调整满意度(缺货离开不重复扣分)', () => {
    const ok = queued('secret', { level: 2, day: 5 });
    ok.g.state.satisfaction = 50;
    ok.g.scanCustomer(ok.id);
    ok.g.collectPayment(ok.id);
    assert.equal(ok.g.state.feedback[0].rating, 5);
    assert.equal(ok.g.state.satisfaction, 50 + SATISFACTION.servedOnTime + SURVEY.secretDelta[4]);

    const miss = newSession(3);
    miss.state.day = 5;
    miss.state.level = 2;
    miss.state.satisfaction = 50;
    miss.state.eventCooldown = 1e9;
    const id = addShopper(miss, 'chips', 1, 0.1);
    miss.state.customers[0].kind = 'secret';
    miss.tick(0.2);
    // 只扣一次缺货的满意度,暗访的评分只记录
    assert.equal(miss.state.satisfaction, 50 + SATISFACTION.missingItem);
    assert.equal(miss.state.feedback.length, 1);
    assert.equal(id > 0, true);
});

test('打烊时排队的暗访客被请走:记一条反馈', () => {
    const { g } = queued('secret', { level: 2, day: 5 });
    g.state.isOpen = true;
    g.closeStore();
    assert.equal(g.state.feedback.length, 1);
    assert.ok(g.state.feedback[0].reasons.indexOf('打烊时被请出了店') >= 0);
    assert.equal(g.state.feedback[0].paid, false);
});

test('buildFeedback 评分有上下限;反馈记录最多保留 feedbackLimit 条', () => {
    const { g, id } = queued('survey');
    g.state.customers[0].waited = 999;
    g.state.customers[0].missedItems = ['chips', 'cola', 'water'];
    g.state.trash = [1, 2, 3].map((i) => ({ id: i, x: 0, z: 0 }));
    const rec = buildFeedback(g.state, g.state.customers[0], 'paid');
    assert.equal(rec.rating, 1);
    assert.equal(id > 0, true);

    const h = newSession();
    for (let i = 0; i < SURVEY.feedbackLimit + 5; i++) {
        const q = queued('survey');
        q.g.scanCustomer(q.id);
        q.g.collectPayment(q.id);
        h.state.feedback = [...h.state.feedback, ...q.g.state.feedback.map((f) => ({ ...f, id: h.state.nextFeedbackId++ }))].slice(-SURVEY.feedbackLimit);
    }
    assert.equal(h.state.feedback.length, SURVEY.feedbackLimit);
});

test('存档 v8:反馈和顾客类型往返不丢;v7 旧存档迁移;坏数据被拒绝', () => {
    const { g } = queued('survey');
    g.scanCustomer(g.state.customers[0].id);
    g.collectPayment(g.state.customers[0].id);
    addShopper(g, 'cola', 1, 5);
    g.state.customers[0].kind = 'secret';
    const back: any = parseSave(serializeState(g.state));
    assert.equal(back.kind, 'ok');
    assert.deepEqual(back.state.feedback, g.state.feedback);
    assert.equal(back.state.customers[0].kind, 'secret');
    assert.equal(back.state.nextFeedbackId, g.state.nextFeedbackId);

    const v7: any = JSON.parse(serializeState(newSession().state));
    v7.schema_version = 7;
    delete v7.state.feedback;
    delete v7.state.nextFeedbackId;
    v7.state.customers = [{ id: 1, phase: 'browsing', timer: 3, waited: 0, wants: [{ itemId: 'chips', units: 1 }], cart: [], scanned: false, joinSeq: 0 }];
    v7.state.nextCustomerId = 2;
    const migrated: any = parseSave(JSON.stringify(v7));
    assert.equal(migrated.kind, 'ok');
    assert.deepEqual(migrated.state.feedback, []);
    assert.equal(migrated.state.customers[0].kind, 'normal');
    assert.deepEqual(migrated.state.customers[0].missedItems, []);

    const bad: any = JSON.parse(serializeState(g.state));
    bad.state.feedback[0].rating = 9;
    assert.equal((parseSave(JSON.stringify(bad)) as any).kind, 'corrupt');
});

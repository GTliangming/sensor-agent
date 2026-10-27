// 顾客调研与反馈:问卷客(结账后给出 3 道选择题的答案)和暗访客(离店后直接影响满意度)。
// 反馈内容全部由真实发生的事推出来(缺货、等待时间、垃圾),所以玩家看到的每条意见都能对应到实际的扣分原因。
import { SURVEY, TRASH, isBeginnerProtected } from '../data/Balance';
import { GOODS, getCatalogItem } from '../data/Catalog';
import { stockedUnits } from '../inventory/Inventory';
import { addSatisfaction } from './Satisfaction';
import type { Customer, CustomerKind, FeedbackRecord, GameState } from '../state/GameState';

/** 顾客离开时的状态:结账完成,或没买成就走了。 */
export type ExitReason = 'paid' | 'noStock' | 'queueFull' | 'angry' | 'kickedOut';

/** 问卷的三道题;前两题的选项固定,第三题答案是一件商品。 */
export const SURVEY_QUESTIONS = [
    { text: '货架好找吗?', options: ['很好找', '一般', '不好找'] },
    { text: '等待时间怎么样?', options: ['很快', '还行', '等太久了'] },
    { text: '想要新增什么商品?', options: [] as string[] },
];

/**
 * 顾客类型由编号决定,不消耗随机数。新手引导期间和第 1 天都是普通客人;
 * 暗访客要 SURVEY.secretMinLevel 级且过了新手保护期。
 */
export function kindForCustomer(state: GameState, customerId: number, guided: boolean): CustomerKind {
    if (guided || state.day < 2) return 'normal';
    const h = (customerId * 37 + 11) % 100;
    if (h < SURVEY.surveyPercent) return 'survey';
    if (h < SURVEY.surveyPercent + SURVEY.secretPercent && state.level >= SURVEY.secretMinLevel && !isBeginnerProtected(state.day)) return 'secret';
    return 'normal';
}

const waitIndex = (waited: number) => (waited <= SURVEY.waitFastSec ? 0 : waited <= SURVEY.waitOkSec ? 1 : 2);

const nameOf = (id: string) => getCatalogItem(id)?.name ?? id;

/** 这位顾客想要的商品:先看他想买却没货的,其次是货架上完全缺货的已解锁商品。 */
function wishFor(state: GameState, c: Customer): string | null {
    if (c.missedItems.length > 0) return c.missedItems[0];
    const empty = GOODS.filter((g) => g.unlockLevel <= state.level && stockedUnits(state, g.id) === 0)[0];
    return empty ? empty.id : null;
}

/** 根据当前店里的真实情况生成这位顾客的反馈(还没有编号)。 */
export function buildFeedback(state: GameState, c: Customer, exit: ExitReason): Omit<FeedbackRecord, 'id'> {
    const reasons: string[] = [];
    const missed = c.missedItems.length;
    const find = exit === 'noStock' ? 2 : missed === 0 ? 0 : missed === 1 ? 1 : 2;
    const wait = exit === 'angry' ? 2 : waitIndex(c.waited);

    if (missed > 0) reasons.push(`没找到想买的:${c.missedItems.map(nameOf).join('、')}`);
    if (exit === 'angry') reasons.push('排队太久,等不下去走了');
    else if (wait === 2) reasons.push('结账等了太久');
    else if (wait === 1) reasons.push('结账等了一会儿');
    if (exit === 'queueFull') reasons.push('队伍太长,没排上队');
    if (exit === 'kickedOut') reasons.push('打烊时被请出了店');
    const dirty = state.trash.length > TRASH.freeCount;
    if (dirty) reasons.push('地上有垃圾,不太干净');

    let rating = 5 - find - wait - (dirty ? 1 : 0);
    if (exit === 'noStock' || exit === 'angry') rating = Math.min(rating, 1);
    else if (exit !== 'paid') rating = Math.min(rating, 2);
    rating = Math.max(1, Math.min(5, rating));

    return {
        day: state.day,
        kind: c.kind === 'secret' ? 'secret' : 'survey',
        rating,
        find,
        wait,
        wishItemId: wishFor(state, c),
        reasons,
        paid: exit === 'paid',
    };
}

/** 记下一条反馈,超过上限时丢掉最旧的。返回记下的那条。 */
export function recordFeedback(state: GameState, rec: Omit<FeedbackRecord, 'id'>): FeedbackRecord {
    const full: FeedbackRecord = { id: state.nextFeedbackId++, ...rec };
    state.feedback = [...state.feedback, full].slice(-SURVEY.feedbackLimit);
    return full;
}

/**
 * 调研类顾客离开时调用:
 * - 问卷客只有结账完成才有问卷;
 * - 暗访客任何方式离开都会留下记录,但只有结账完成的才按评分调整满意度
 *   (没买成就走的情况,缺货/等太久/队伍太长的扣分已经另外扣过,不重复扣)。
 * 普通客人返回 null。
 */
export function recordExit(state: GameState, c: Customer, exit: ExitReason): FeedbackRecord | null {
    if (c.kind === 'normal') return null;
    if (c.kind === 'survey' && exit !== 'paid') return null;
    const rec = recordFeedback(state, buildFeedback(state, c, exit));
    if (c.kind === 'secret' && exit === 'paid') addSatisfaction(state, SURVEY.secretDelta[rec.rating - 1]);
    return rec;
}

/** 反馈里"想要的商品"一栏显示的文字。 */
export function wishText(rec: FeedbackRecord): string {
    return rec.wishItemId ? nameOf(rec.wishItemId) : '没有特别想要的';
}

// 新手引导:强制、不可跳过的一串步骤。每一步的完成条件都从游戏状态推导出来(而不是靠额外的"点击确认"),
// 这样不会因为玩家的做法和预想不同而卡死,也容易测试。
// 只有"走动"(表现层汇报)和最后一步"看面板"(玩家点确认)需要显式信号。
import type { GameState } from '../state/GameState';
import { getCatalogItem } from '../data/Catalog';
import type { StoreLayout } from '../world/StoreLayout';

export interface TutorialStepDef {
    id: 'move' | 'computer' | 'wait' | 'stock' | 'open' | 'sell' | 'hud';
    title: string;
    hint: string;
    /** 3D 场景里要高亮的地点。 */
    target: 'computer' | 'unload' | 'counter' | null;
    /** 需要玩家点"知道了"才算完成。 */
    needsAck?: boolean;
}

export const TUTORIAL_STEPS: TutorialStepDef[] = [
    { id: 'move', title: '先走动一下', hint: '左半屏按住拖动是移动,右半屏拖动是转视角。走几步试试。电脑上用 WASD 和鼠标。', target: null },
    { id: 'computer', title: '去店长电脑采购', hint: '走到左边的电脑桌,点「使用电脑」,买第一批零食或饮料。', target: 'computer' },
    { id: 'wait', title: '等货车送货', hint: '货车正在路上。着急的话,在电脑的「订单」页可以看广告立即送达。', target: null },
    { id: 'stock', title: '搬箱子上架', hint: '到店门外的黄色卸货区搬起纸箱,走进店里放到对应的货架。雪糕要放冷柜。', target: 'unload' },
    { id: 'open', title: '开门营业', hint: '点右上角的「开门营业」按钮。夜间不能开门,等天亮。', target: null },
    { id: 'sell', title: '接待顾客', hint: '顾客会到收银台排队。走到收银台旁,依次点「扫码」「收款」。', target: 'counter' },
    { id: 'hud', title: '看看顶部的面板', hint: '左上角是金币、满意度、等级。满意度越高,来的顾客越多。', target: null, needsAck: true },
];

export const TUTORIAL_STEP_COUNT = TUTORIAL_STEPS.length;

export function isTutorialActive(state: GameState): boolean {
    return state.tutorial.step < TUTORIAL_STEP_COUNT;
}

/** 有没有商品类(不是设备)的订单、纸箱或库存——"买了第一批货"的标志。 */
function hasGoodsPipeline(state: GameState): boolean {
    const isGoods = (id: string) => getCatalogItem(id)?.kind === 'goods';
    return (
        state.orders.some((o) => isGoods(o.itemId)) ||
        state.cartons.some((c) => isGoods(c.itemId)) ||
        Object.keys(state.stock).length > 0
    );
}

/** 当前步骤的完成条件是否已满足(needsAck 的步骤不在这里完成)。 */
function isStepComplete(id: TutorialStepDef['id'], state: GameState): boolean {
    switch (id) {
        case 'move':
            return state.tutorial.moved;
        case 'computer':
            return hasGoodsPipeline(state);
        case 'wait':
            return state.cartons.some((c) => getCatalogItem(c.itemId)?.kind === 'goods') || Object.keys(state.stock).length > 0;
        case 'stock':
            return Object.keys(state.stock).length > 0;
        case 'open':
            return state.isOpen || state.totalServed > 0;
        case 'sell':
            return state.totalServed > 0;
        case 'hud':
            return false;
    }
}

/** 按顺序推进引导,返回本次新完成的步骤序号。 */
export function advanceTutorial(state: GameState): number[] {
    const done: number[] = [];
    while (state.tutorial.step < TUTORIAL_STEP_COUNT) {
        const def = TUTORIAL_STEPS[state.tutorial.step];
        if (def.needsAck || !isStepComplete(def.id, state)) break;
        done.push(state.tutorial.step);
        state.tutorial.step++;
    }
    return done;
}

/** 玩家点"知道了":只在需要确认的步骤有效。 */
export function acknowledgeTutorial(state: GameState): boolean {
    const def = TUTORIAL_STEPS[state.tutorial.step];
    if (!def || !def.needsAck) return false;
    state.tutorial.step++;
    return true;
}

/** 当前步骤要高亮的地面位置。 */
export function tutorialTarget(state: GameState, layout: StoreLayout): { x: number; z: number } | null {
    const def = TUTORIAL_STEPS[state.tutorial.step];
    if (!def || !def.target) return null;
    if (def.target === 'unload') return { x: layout.unloadZone.x, z: layout.unloadZone.z };
    const fixture = layout.fixtures.find((f) => f.kind === def.target);
    return fixture ? { x: fixture.x, z: fixture.z } : null;
}

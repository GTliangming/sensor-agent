// 顶部 HUD:金币/满意度/等级、日期与时段、开门/打烊按钮、交互提示按钮、临时提示。
// 只读取 GameState 来显示,点击按钮时回调给外部去执行命令,自己不改任何经营数据。
// 位置会避开刘海/圆角安全区和微信右上角的胶囊按钮(见 platform/SafeArea)。
import { Canvas, Color, Label, view } from 'cc';
import { nextLevelXp } from '../core/data/Levels';
import { WEATHER } from '../core/events/Weather';
import type { GameState } from '../core/state/GameState';
import { DayPhase, formatClock } from '../core/time/GameClock';
import type { HudInsets } from '../platform/SafeArea';
import { COLOR_WHITE, UiButton, makeButton, makeLabel } from './UiKit';

const PHASE_NAMES: Record<DayPhase, string> = { morning: '早上', noon: '中午', evening: '傍晚', night: '夜间' };
const BTN_W = 220;
const BTN_H = 60;
const ACTION_W = 400;
const ACTION_H = 54;
/** 同时最多显示几个动作按钮(与 core/world/Actions 的上限一致)。 */
const MAX_ACTIONS = 5;
const MARGIN = 24;
const TOAST_SECONDS = 2.5;

const GREEN = new Color(46, 168, 90, 235);
const RED = new Color(200, 70, 60, 235);
const GRAY = new Color(110, 110, 120, 235);
const BLUE = new Color(52, 120, 220, 235);

export interface HudHandlers {
    onToggleStore: () => void;
    /** 点击第 index 个动作按钮。 */
    onAction: (index: number) => void;
}

export class HudView {
    private readonly stats: Label;
    private readonly clock: Label;
    private readonly toast: Label;
    private readonly storeBtn: UiButton;
    private readonly carried: Label;
    private readonly actionBtns: UiButton[] = [];
    private toastLeft = 0;
    private last = { stats: '', clock: '', btn: '', actions: '', carried: '' };

    constructor(canvas: Canvas, insets: HudInsets, handlers: HudHandlers) {
        const size = view.getVisibleSize();
        const halfW = size.width / 2;
        const halfH = size.height / 2;
        const root = canvas.node;

        const leftX = -halfW + insets.left + MARGIN;
        const leftY = halfH - insets.top - MARGIN;
        const rightX = halfW - insets.right - MARGIN;
        const rightY = halfH - insets.rightTop - MARGIN;

        this.stats = makeLabel(root, 'Stats', '', { size: 26, align: Label.HorizontalAlign.LEFT, ax: 0, ay: 1, outline: true }, leftX, leftY);
        this.clock = makeLabel(root, 'Clock', '', { size: 26, align: Label.HorizontalAlign.RIGHT, ax: 1, ay: 1, outline: true }, rightX, rightY);
        this.toast = makeLabel(root, 'Toast', '', { size: 30, align: Label.HorizontalAlign.CENTER, outline: true }, 0, halfH * 0.05);

        this.storeBtn = makeButton(root, 'StoreButton', '开门营业', BTN_W, BTN_H, rightX - BTN_W / 2, rightY - 78 - BTN_H / 2, GREEN, handlers.onToggleStore);
        // 动作按钮从右下角向上堆叠
        for (let i = 0; i < MAX_ACTIONS; i++) {
            const y = -halfH + insets.bottom + MARGIN + 60 + i * (ACTION_H + 10);
            const btn = makeButton(root, `Action_${i}`, '', ACTION_W, ACTION_H, rightX - ACTION_W / 2, y, BLUE, () => handlers.onAction(i));
            btn.setVisible(false);
            this.actionBtns.push(btn);
        }
        this.carried = makeLabel(root, 'Carried', '', { size: 26, align: Label.HorizontalAlign.CENTER, color: new Color(255, 230, 140, 255), outline: true }, 0, -halfH * 0.55);
    }

    /**
     * 每帧调用:只有内容变化时才真正改文字/重绘。
     * actions 是当前位置可做的动作文字(为空表示附近没有可交互的东西);carriedText 是手里抱着的东西。
     */
    update(state: GameState, phase: DayPhase, dt: number, actions: string[], carriedText: string): void {
        const next = nextLevelXp(state.level);
        const xp = next === null ? '已满级' : `经验 ${state.xp}/${next}`;
        const stats = `金币 ${state.coins}\n满意度 ${Math.round(state.satisfaction)}\n等级 ${state.level}  ${xp}`;
        if (stats !== this.last.stats) {
            this.last.stats = stats;
            this.stats.string = stats;
        }

        const clock = `第 ${state.day} 天 · ${PHASE_NAMES[phase]} ${formatClock(state.timeOfDay)}\n${WEATHER[state.weather].name} · ${state.isOpen ? '营业中' : '已打烊'}`;
        if (clock !== this.last.clock) {
            this.last.clock = clock;
            this.clock.string = clock;
        }

        const resting = !state.isOpen && phase === 'night';
        const btn = state.isOpen ? 'close' : resting ? 'rest' : 'open';
        if (btn !== this.last.btn) {
            this.last.btn = btn;
            this.storeBtn.setText(btn === 'close' ? '打烊' : btn === 'rest' ? '夜间休息' : '开门营业');
            this.storeBtn.setColor(btn === 'close' ? RED : btn === 'rest' ? GRAY : GREEN);
        }

        const actionsKey = actions.join('|');
        if (actionsKey !== this.last.actions) {
            this.last.actions = actionsKey;
            this.actionBtns.forEach((btn, i) => {
                btn.setVisible(i < actions.length);
                if (i < actions.length) btn.setText(actions[i]);
            });
        }

        if (carriedText !== this.last.carried) {
            this.last.carried = carriedText;
            this.carried.string = carriedText;
        }

        if (this.toastLeft > 0) {
            this.toastLeft = Math.max(0, this.toastLeft - dt);
            const alpha = Math.min(1, this.toastLeft / 0.5); // 最后 0.5 秒淡出
            this.toast.color = new Color(255, 255, 255, Math.round(255 * alpha));
            if (this.toastLeft === 0) this.toast.string = '';
        }
    }

    /** 屏幕中上方弹出一条提示,几秒后淡出。 */
    showMessage(text: string): void {
        this.toast.string = text;
        this.toast.color = COLOR_WHITE;
        this.toastLeft = TOAST_SECONDS;
    }
}

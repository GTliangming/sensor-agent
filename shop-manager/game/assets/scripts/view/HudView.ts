// 顶部 HUD:金币/满意度/等级、日期与时段、开门/打烊按钮、临时提示。
// 只读取 GameState 来显示,点击按钮时回调给外部去执行命令,自己不改任何经营数据。
import { Canvas, Color, Graphics, Label, Layers, Node, UITransform, view } from 'cc';
import type { GameState } from '../core/state/GameState';
import { DayPhase, formatClock } from '../core/time/GameClock';

const PHASE_NAMES: Record<DayPhase, string> = { morning: '早上', noon: '中午', evening: '傍晚', night: '夜间' };
const BTN_W = 220;
const BTN_H = 60;
const MARGIN = 24;
const TOAST_SECONDS = 2.5;

const WHITE = new Color(255, 255, 255, 255);
const OUTLINE = new Color(20, 20, 30, 255);

export class HudView {
    private readonly stats: Label;
    private readonly clock: Label;
    private readonly toast: Label;
    private readonly btnGfx: Graphics;
    private readonly btnLabel: Label;
    private toastLeft = 0;
    private last = { stats: '', clock: '', btn: '' };

    constructor(canvas: Canvas, onToggleStore: () => void) {
        const size = view.getVisibleSize();
        const halfW = size.width / 2;
        const halfH = size.height / 2;

        this.stats = this.makeLabel(canvas.node, 'Stats', 26, Label.HorizontalAlign.LEFT, 0, 1, -halfW + MARGIN, halfH - MARGIN);
        this.clock = this.makeLabel(canvas.node, 'Clock', 26, Label.HorizontalAlign.RIGHT, 1, 1, halfW - MARGIN, halfH - MARGIN);
        this.toast = this.makeLabel(canvas.node, 'Toast', 30, Label.HorizontalAlign.CENTER, 0.5, 0.5, 0, halfH * 0.35);
        this.toast.string = '';

        // 按钮:圆角矩形 + 文字,点击回调
        const btn = new Node('StoreButton');
        btn.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(btn);
        btn.addComponent(UITransform).setContentSize(BTN_W, BTN_H);
        btn.setPosition(halfW - MARGIN - BTN_W / 2, halfH - MARGIN - 78 - BTN_H / 2, 0);
        this.btnGfx = btn.addComponent(Graphics);
        this.btnLabel = this.makeLabel(btn, 'Text', 26, Label.HorizontalAlign.CENTER, 0.5, 0.5, 0, 0);
        btn.on(Node.EventType.TOUCH_END, onToggleStore);
    }

    /** 每帧调用:只有内容变化时才真正改文字/重绘。 */
    update(state: GameState, phase: DayPhase, dt: number): void {
        const stats = `金币 ${state.coins}\n满意度 ${Math.round(state.satisfaction)}\n等级 ${state.level}`;
        if (stats !== this.last.stats) {
            this.last.stats = stats;
            this.stats.string = stats;
        }

        const clock = `第 ${state.day} 天 · ${PHASE_NAMES[phase]} ${formatClock(state.timeOfDay)}\n${state.isOpen ? '营业中' : '已打烊'}`;
        if (clock !== this.last.clock) {
            this.last.clock = clock;
            this.clock.string = clock;
        }

        const resting = !state.isOpen && phase === 'night';
        const btn = state.isOpen ? 'close' : resting ? 'rest' : 'open';
        if (btn !== this.last.btn) {
            this.last.btn = btn;
            const fill = btn === 'close' ? new Color(200, 70, 60, 235) : btn === 'rest' ? new Color(110, 110, 120, 235) : new Color(46, 168, 90, 235);
            this.btnLabel.string = btn === 'close' ? '打烊' : btn === 'rest' ? '夜间休息' : '开门营业';
            const g = this.btnGfx;
            g.clear();
            g.fillColor = fill;
            g.roundRect(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H, 12);
            g.fill();
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
        this.toast.color = WHITE;
        this.toastLeft = TOAST_SECONDS;
    }

    private makeLabel(parent: Node, name: string, size: number, align: number, ax: number, ay: number, x: number, y: number): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        parent.addChild(node);
        const label = node.addComponent(Label);
        label.fontSize = size;
        label.lineHeight = size + 8;
        label.horizontalAlign = align;
        label.color = WHITE;
        label.enableOutline = true;
        label.outlineColor = OUTLINE;
        label.outlineWidth = 3;
        node.getComponent(UITransform)!.setAnchorPoint(ax, ay);
        node.setPosition(x, y, 0);
        return label;
    }
}

// 突发事件卡片:屏幕左侧一张卡,显示事件标题、说明、倒计时和应对选项。多个事件时先处理最早的一个。
// 事件内容与结算规则都在 core/events/EventSystem,这里只负责显示和把点击交给外部。
import { Canvas, Color, Graphics, Label, Node, view } from 'cc';
import { describeEvent } from '../core/events/EventSystem';
import type { GameState } from '../core/state/GameState';
import type { HudInsets } from '../platform/SafeArea';
import { UiButton, fillRoundRect, makeButton, makeLabel, makeNode, makeRect } from './UiKit';

const CARD_W = 380;
const CARD_H = 270;
const GOLD = new Color(255, 214, 90, 255);
const BLUE = new Color(52, 120, 220, 240);
const GRAY = new Color(96, 98, 108, 240);

export class EventPanel {
    private readonly root: Node;
    private readonly title: Label;
    private readonly body: Label;
    private readonly timer: Label;
    private readonly bar: Graphics;
    private readonly more: Label;
    private readonly buttons: UiButton[] = [];
    private currentId = -1;
    private optionIds: string[] = [];
    private last = { key: '', seconds: -1 };

    constructor(canvas: Canvas, insets: HudInsets, onChoose: (eventId: number, optionId: string) => void) {
        const size = view.getVisibleSize();
        // 左侧,放在"左上角面板"和"顶部引导条"的下方
        const x = -size.width / 2 + insets.left + 24 + CARD_W / 2;
        const y = size.height / 2 - insets.top - 250 - CARD_H / 2;
        this.root = makeNode(canvas.node, 'EventPanel', x, y);
        makeRect(this.root, 'Bg', CARD_W, CARD_H, 0, 0, new Color(24, 28, 40, 225), 14);

        const left = -CARD_W / 2 + 18;
        this.title = makeLabel(this.root, 'Title', '', { size: 26, color: GOLD, align: Label.HorizontalAlign.LEFT, ax: 0 }, left, CARD_H / 2 - 28);
        this.body = makeLabel(this.root, 'Body', '', { size: 19, align: Label.HorizontalAlign.LEFT, ax: 0, ay: 1, wrapWidth: CARD_W - 36 }, left, CARD_H / 2 - 52);
        this.timer = makeLabel(this.root, 'Timer', '', { size: 18, color: new Color(170, 178, 196, 255), align: Label.HorizontalAlign.LEFT, ax: 0 }, left, -20);
        this.bar = makeNode(this.root, 'Bar', 0, -42).addComponent(Graphics);
        this.more = makeLabel(this.root, 'More', '', { size: 16, color: new Color(170, 178, 196, 255), align: Label.HorizontalAlign.RIGHT, ax: 1 }, CARD_W / 2 - 18, -20);

        for (let i = 0; i < 2; i++) {
            const btn = makeButton(this.root, `Option_${i}`, '', CARD_W - 36, 46, 0, -78 - i * 54, i === 0 ? BLUE : GRAY, () => {
                if (this.currentId >= 0 && this.optionIds[i]) onChoose(this.currentId, this.optionIds[i]);
            });
            this.buttons.push(btn);
        }
        this.root.active = false;
    }

    update(state: GameState): void {
        const ev = state.events[0];
        if (!ev) {
            this.root.active = false;
            this.currentId = -1;
            this.last = { key: '', seconds: -1 };
            return;
        }
        this.root.active = true;
        this.currentId = ev.id;
        const desc = describeEvent(ev);

        const key = `${ev.id}|${state.events.length}`;
        if (key !== this.last.key) {
            this.last.key = key;
            this.title.string = `突发事件 · ${desc.title}`;
            this.body.string = desc.body;
            this.more.string = state.events.length > 1 ? `还有 ${state.events.length - 1} 个` : '';
            this.optionIds = desc.options.map((o) => o.id);
            this.buttons.forEach((b, i) => {
                const o = desc.options[i];
                b.setVisible(o !== undefined);
                if (o) {
                    b.setText(o.cost > 0 ? `${o.label}(${o.cost} 金币)` : o.label);
                    b.setColor(o.id === 'ignore' ? GRAY : BLUE);
                }
            });
        }

        const seconds = Math.ceil(ev.remainingSec);
        if (seconds !== this.last.seconds) {
            this.last.seconds = seconds;
            this.timer.string = `剩余 ${seconds} 秒,不处理会有损失`;
            const ratio = Math.max(0, Math.min(1, ev.remainingSec / ev.totalSec));
            const w = CARD_W - 36;
            this.bar.clear();
            this.bar.fillColor = new Color(60, 66, 84, 255);
            this.bar.roundRect(-w / 2, -5, w, 10, 5);
            this.bar.fill();
            this.bar.fillColor = ratio > 0.33 ? new Color(90, 200, 120, 255) : new Color(230, 90, 80, 255);
            this.bar.roundRect(-w / 2, -5, Math.max(w * ratio, 10), 10, 5);
            this.bar.fill();
        }
    }
}

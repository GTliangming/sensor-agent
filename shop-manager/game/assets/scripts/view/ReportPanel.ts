// 日结算面板:每天结束后弹出,总结收入、接待、畅销、缺货和满意度变化,点"继续"关闭。
import { BlockInputEvents, Canvas, Color, Label, Node, view } from 'cc';
import { getCatalogItem } from '../core/data/Catalog';
import type { DayReport } from '../core/state/GameState';
import { COLOR_WHITE, makeButton, makeLabel, makeNode, makeRect } from './UiKit';

const PANEL_W = 640;
const PANEL_H = 520;
const GOLD = new Color(255, 214, 90, 255);

const nameOf = (id: string) => getCatalogItem(id)?.name ?? id;

/** 根据日报给一句建议,帮玩家知道下一步该做什么。 */
function adviceFor(r: DayReport): string {
    if (r.served === 0 && r.lost === 0) return '今天没有营业。早上记得点「开门营业」。';
    if (r.missed.length > 0) return `顾客想买却缺货:${r.missed.map(nameOf).join('、')}。去电脑补货吧。`;
    if (r.lost > r.served) return '流失的顾客比接待的还多:货架要补满,收银也要及时。';
    return '经营得不错,继续保持。多备几种商品,客流会更大。';
}

export class ReportPanel {
    private readonly root: Node;
    private readonly title: Label;
    private readonly body: Label;
    private readonly advice: Label;

    constructor(canvas: Canvas, onContinue: () => void) {
        const size = view.getVisibleSize();
        this.root = makeNode(canvas.node, 'ReportPanel');
        makeRect(this.root, 'Overlay', size.width * 2, size.height * 2, 0, 0, new Color(0, 0, 0, 170), 0).addComponent(BlockInputEvents);
        makeRect(this.root, 'Bg', PANEL_W, PANEL_H, 0, 0, new Color(28, 32, 44, 250), 18).addComponent(BlockInputEvents);

        const left = -PANEL_W / 2 + 40;
        this.title = makeLabel(this.root, 'Title', '', { size: 36, color: GOLD }, 0, PANEL_H / 2 - 52);
        this.body = makeLabel(this.root, 'Body', '', { size: 26, align: Label.HorizontalAlign.LEFT, ax: 0, ay: 1, wrapWidth: PANEL_W - 80 }, left, PANEL_H / 2 - 110);
        this.advice = makeLabel(this.root, 'Advice', '', { size: 22, color: COLOR_WHITE, align: Label.HorizontalAlign.LEFT, ax: 0, ay: 1, wrapWidth: PANEL_W - 80 }, left, -60);
        makeButton(this.root, 'Continue', '继续', 220, 56, 0, -PANEL_H / 2 + 50, new Color(46, 168, 90, 255), onContinue);
        this.root.active = false;
    }

    get isOpen(): boolean {
        return this.root.active;
    }

    show(r: DayReport): void {
        this.title.string = `第 ${r.day} 天结算`;
        const delta = Math.round(r.satisfactionEnd - r.satisfactionStart);
        const lines = [
            `营业收入   +${r.revenue} 金币`,
            `接待顾客   ${r.served} 位(流失 ${r.lost} 位)`,
            `卖出商品   ${r.soldUnits} 件`,
            `畅销商品   ${r.bestSeller ? nameOf(r.bestSeller) : '无'}`,
            `缺货商品   ${r.missed.length > 0 ? r.missed.map(nameOf).join('、') : '无'}`,
            `满意度     ${Math.round(r.satisfactionStart)} → ${Math.round(r.satisfactionEnd)}(${delta >= 0 ? '+' : ''}${delta})`,
        ];
        this.body.string = lines.join('\n');
        this.advice.string = adviceFor(r);
        this.root.active = true;
    }

    hide(): void {
        this.root.active = false;
    }
}

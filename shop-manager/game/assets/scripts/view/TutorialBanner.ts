// 新手引导的界面:屏幕上方的步骤提示条 + 3D 场景里的高亮柱(指向该去的地方)。
// 提示内容与完成条件都在 core/tutorial/Tutorial.ts,这里只负责显示。
import { Canvas, Color, Label, Node, view } from 'cc';
import { TUTORIAL_STEPS, TUTORIAL_STEP_COUNT } from '../core/tutorial/Tutorial';
import type { GameState } from '../core/state/GameState';
import type { HudInsets } from '../platform/SafeArea';
import { BoxFactory } from './BoxFactory';
import { UiButton, makeButton, makeLabel, makeNode, makeRect } from './UiKit';

const BANNER_W = 780;
const BANNER_H = 104;
const GOLD = new Color(255, 214, 90, 255);

export class TutorialBanner {
    private readonly root: Node;
    private readonly title: Label;
    private readonly hint: Label;
    private readonly ackButton: UiButton;
    private lastStep = -2;

    constructor(canvas: Canvas, insets: HudInsets, onAck: () => void) {
        const size = view.getVisibleSize();
        // 放在左上角面板和右上角时间的下方,避免与它们重叠
        const y = size.height / 2 - insets.top - 132 - BANNER_H / 2;
        this.root = makeNode(canvas.node, 'TutorialBanner', 0, y);
        makeRect(this.root, 'Bg', BANNER_W, BANNER_H, 0, 0, new Color(20, 24, 36, 215), 14);
        this.title = makeLabel(this.root, 'Title', '', { size: 26, color: GOLD }, 0, BANNER_H / 2 - 24);
        this.hint = makeLabel(this.root, 'Hint', '', { size: 20, ay: 1, wrapWidth: BANNER_W - 40 }, 0, BANNER_H / 2 - 44);
        this.ackButton = makeButton(this.root, 'Ack', '知道了', 200, 52, 0, -BANNER_H / 2 - 40, new Color(46, 168, 90, 240), onAck);
        this.ackButton.setVisible(false);
        this.root.active = false;
    }

    update(state: GameState): void {
        const step = state.tutorial.step;
        if (step === this.lastStep) return;
        this.lastStep = step;
        if (step >= TUTORIAL_STEP_COUNT) {
            this.root.active = false;
            return;
        }
        const def = TUTORIAL_STEPS[step];
        this.root.active = true;
        this.title.string = `新手引导 ${step + 1}/${TUTORIAL_STEP_COUNT} · ${def.title}`;
        this.hint.string = def.hint;
        this.ackButton.setVisible(def.needsAck === true);
    }
}

/** 3D 场景里一根上下浮动的黄色柱子,标出新手引导当前该去的地方。 */
export class GuideMarker {
    private readonly node: Node;
    private time = 0;

    constructor(parent: Node, boxes: BoxFactory) {
        this.node = new Node('GuideMarker');
        boxes.addBox(this.node, 'Pillar', 0, 1.2, 0, 0.3, 2.4, 0.3, new Color(255, 214, 60, 255));
        parent.addChild(this.node);
        this.node.active = false;
    }

    update(target: { x: number; z: number } | null, dt: number): void {
        this.time += dt;
        this.node.active = target !== null;
        if (target) this.node.setPosition(target.x, 0.15 * Math.sin(this.time * 3), target.z);
    }
}

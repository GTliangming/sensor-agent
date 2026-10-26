// 用代码搭 UI 的小工具:文字、圆角矩形、按钮。所有节点都放在 UI_2D 层,由 Canvas 的 UI 相机渲染。
// (不能沿用 Canvas 节点自身的层级——实测场景里的 Canvas 节点层是 DEFAULT,见 JoystickView 里的说明。)
import { Color, Graphics, Label, Layers, Node, UITransform } from 'cc';

export const COLOR_WHITE = new Color(255, 255, 255, 255);
const OUTLINE = new Color(20, 20, 30, 255);
const DISABLED = new Color(96, 98, 108, 235);

export function makeNode(parent: Node, name: string, x = 0, y = 0): Node {
    const node = new Node(name);
    node.layer = Layers.Enum.UI_2D;
    parent.addChild(node);
    node.setPosition(x, y, 0);
    return node;
}

export interface LabelStyle {
    size?: number;
    color?: Color;
    /** Label.HorizontalAlign 的值。 */
    align?: number;
    /** 锚点(0~1),决定 (x, y) 指向文字块的哪个位置。 */
    ax?: number;
    ay?: number;
    /** 描边,深色底/复杂背景上更易读。 */
    outline?: boolean;
    /** 指定宽度并自动换行(高度随内容变化)。 */
    wrapWidth?: number;
}

export function makeLabel(parent: Node, name: string, text: string, style: LabelStyle, x: number, y: number): Label {
    const node = makeNode(parent, name, x, y);
    const label = node.addComponent(Label);
    const size = style.size ?? 24;
    label.string = text;
    label.fontSize = size;
    label.lineHeight = size + 8;
    label.color = style.color ?? COLOR_WHITE;
    if (style.align !== undefined) label.horizontalAlign = style.align;
    if (style.outline) {
        label.enableOutline = true;
        label.outlineColor = OUTLINE;
        label.outlineWidth = 3;
    }
    const ui = node.getComponent(UITransform)!;
    if (style.wrapWidth) {
        label.overflow = Label.Overflow.RESIZE_HEIGHT;
        label.enableWrapText = true;
        ui.width = style.wrapWidth;
    }
    ui.setAnchorPoint(style.ax ?? 0.5, style.ay ?? 0.5);
    return label;
}

/** 在 Graphics 上画一个以原点为中心的圆角矩形。 */
export function fillRoundRect(g: Graphics, w: number, h: number, color: Color, radius = 10): void {
    g.clear();
    g.fillColor = color;
    g.roundRect(-w / 2, -h / 2, w, h, radius);
    g.fill();
}

export function makeRect(parent: Node, name: string, w: number, h: number, x: number, y: number, color: Color, radius = 12): Node {
    const node = makeNode(parent, name, x, y);
    node.addComponent(UITransform).setContentSize(w, h);
    fillRoundRect(node.addComponent(Graphics), w, h, color, radius);
    return node;
}

export interface UiButton {
    node: Node;
    label: Label;
    setText(text: string): void;
    setColor(color: Color): void;
    setEnabled(enabled: boolean): void;
    setVisible(visible: boolean): void;
}

/** 圆角按钮:点击(手指在按钮上抬起)时回调;禁用状态显示灰色且不响应。 */
export function makeButton(
    parent: Node,
    name: string,
    text: string,
    w: number,
    h: number,
    x: number,
    y: number,
    color: Color,
    onClick: () => void,
): UiButton {
    const node = makeNode(parent, name, x, y);
    node.addComponent(UITransform).setContentSize(w, h);
    const gfx = node.addComponent(Graphics);
    const label = makeLabel(node, 'Text', text, { size: 24 }, 0, 0);

    let base = color;
    let enabled = true;
    const redraw = () => fillRoundRect(gfx, w, h, enabled ? base : DISABLED, 10);
    redraw();

    node.on(Node.EventType.TOUCH_END, () => {
        if (enabled) onClick();
    });

    return {
        node,
        label,
        setText: (t) => {
            if (label.string !== t) label.string = t;
        },
        setColor: (c) => {
            base = c;
            redraw();
        },
        setEnabled: (e) => {
            if (enabled === e) return;
            enabled = e;
            redraw();
        },
        setVisible: (v) => {
            node.active = v;
        },
    };
}

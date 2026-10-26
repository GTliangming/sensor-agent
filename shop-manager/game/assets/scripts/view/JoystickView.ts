// 屏幕上的辅助显示:虚拟摇杆图形 + 操作提示文字。
// 需要场景里有一个 Canvas(在编辑器里:创建 -> UI 组件 -> Canvas,会自动带 UI 相机)。
import { Canvas, Color, Graphics, Label, Layers, Node, view } from 'cc';
import type { StickState } from './InputController';

const HINT_TEXT = '触屏:左半屏拖动 = 移动,右半屏拖动 = 转视角;靠近电脑桌、门口纸箱、货架时右下角会出现操作按钮\nPC 预览:WASD / 方向键移动,按住鼠标拖动转视角,按 E 执行第一个按钮';

export class JoystickView {
    private readonly graphics: Graphics;

    constructor(canvas: Canvas) {
        // 必须显式设为 UI_2D 层:只有 UI 相机渲染这一层。
        // 不能沿用 canvas.node.layer——实测场景里的 Canvas 节点层是 DEFAULT,沿用会被 3D 相机当成世界物体而看不见。
        const stickNode = new Node('Joystick');
        stickNode.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(stickNode);
        this.graphics = stickNode.addComponent(Graphics);

        const hintNode = new Node('Hint');
        hintNode.layer = Layers.Enum.UI_2D;
        canvas.node.addChild(hintNode);
        const label = hintNode.addComponent(Label);
        label.string = HINT_TEXT;
        label.fontSize = 20;
        label.lineHeight = 28;
        label.color = new Color(255, 255, 255, 255);
        label.enableOutline = true;
        label.outlineColor = new Color(20, 20, 30, 255);
        label.outlineWidth = 3;
        hintNode.setPosition(0, -view.getVisibleSize().height / 2 + 44, 0);
    }

    /** 每帧刷新摇杆图形;没有按住摇杆时什么都不画。 */
    update(stick: StickState): void {
        const g = this.graphics;
        g.clear();
        if (!stick.active) return;

        // UI 坐标原点在屏幕左下,Canvas 子节点的本地原点在屏幕中心,需要平移
        const size = view.getVisibleSize();
        const ox = size.width / 2;
        const oy = size.height / 2;

        g.lineWidth = 4;
        g.fillColor = new Color(255, 255, 255, 60);
        g.strokeColor = new Color(255, 255, 255, 180);
        g.circle(stick.centerX - ox, stick.centerY - oy, stick.radius);
        g.fill();
        g.stroke();

        g.fillColor = new Color(255, 255, 255, 190);
        g.circle(stick.thumbX - ox, stick.thumbY - oy, stick.radius * 0.38);
        g.fill();
    }
}

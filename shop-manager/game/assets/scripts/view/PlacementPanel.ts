// 摆放设备时的界面:一个选择面板(从仓库里挑一件设备)和一个"幽灵方块"(预览放在哪里、能不能放)。
import { BlockInputEvents, Canvas, Color, Label, Node, view } from 'cc';
import { getCatalogItem } from '../core/data/Catalog';
import type { Rect } from '../core/world/StoreLayout';
import { BoxFactory } from './BoxFactory';
import { UiButton, makeButton, makeLabel, makeNode, makeRect } from './UiKit';

const PANEL_W = 560;
const PANEL_H = 480;
const MAX_ROWS = 6;
const ROW_H = 58;

interface Row {
    root: Node;
    label: Label;
    button: UiButton;
    equipId: string;
}

/** 从仓库里选一件设备去摆放。 */
export class PlacementPanel {
    private readonly root: Node;
    private readonly empty: Label;
    private readonly rows: Row[] = [];

    constructor(canvas: Canvas, private readonly onChoose: (equipId: string) => void) {
        const size = view.getVisibleSize();
        this.root = makeNode(canvas.node, 'PlacementPanel');
        makeRect(this.root, 'Overlay', size.width * 2, size.height * 2, 0, 0, new Color(0, 0, 0, 150), 0).addComponent(BlockInputEvents);
        makeRect(this.root, 'Bg', PANEL_W, PANEL_H, 0, 0, new Color(28, 32, 44, 250), 18).addComponent(BlockInputEvents);
        makeLabel(this.root, 'Title', '选择要摆放的设备', { size: 30 }, 0, PANEL_H / 2 - 40);
        this.empty = makeLabel(this.root, 'Empty', '仓库里没有设备了', { size: 24, color: new Color(170, 178, 196, 255) }, 0, 20);
        makeButton(this.root, 'Cancel', '取消', 180, 50, 0, -PANEL_H / 2 + 40, new Color(86, 92, 110, 255), () => this.close());

        for (let i = 0; i < MAX_ROWS; i++) {
            const y = PANEL_H / 2 - 110 - i * ROW_H;
            const rowRoot = makeNode(this.root, `Row_${i}`, 0, y);
            makeRect(rowRoot, 'Bg', PANEL_W - 60, ROW_H - 8, 0, 0, new Color(40, 46, 62, 255), 10);
            const label = makeLabel(rowRoot, 'Name', '', { size: 24, align: Label.HorizontalAlign.LEFT, ax: 0 }, -(PANEL_W - 60) / 2 + 20, 0);
            const row: Row = { root: rowRoot, label, button: null as unknown as UiButton, equipId: '' };
            row.button = makeButton(rowRoot, 'Pick', '摆放', 120, 44, (PANEL_W - 60) / 2 - 80, 0, new Color(52, 120, 220, 255), () => {
                this.close();
                this.onChoose(row.equipId);
            });
            this.rows.push(row);
        }
        this.root.active = false;
    }

    get isOpen(): boolean {
        return this.root.active;
    }

    open(warehouse: { [equipId: string]: number }): void {
        const ids = Object.keys(warehouse).filter((id) => warehouse[id] > 0);
        this.empty.node.active = ids.length === 0;
        this.rows.forEach((row, i) => {
            const id = ids[i];
            row.root.active = id !== undefined;
            if (id === undefined) return;
            const item = getCatalogItem(`equip:${id}`);
            row.equipId = id;
            row.label.string = `${item ? item.name : id} × ${warehouse[id]}`;
        });
        this.root.active = true;
    }

    close(): void {
        this.root.active = false;
    }
}

/** 摆放预览:一个半透明感的方块跟着准星前方的网格位置,绿色 = 可以放,红色 = 不能放。 */
export class PlacementGhost {
    private readonly ok: Node;
    private readonly bad: Node;

    constructor(parent: Node, boxes: BoxFactory) {
        this.ok = boxes.addBox(parent, 'GhostOk', 0, 0, 0, 1, 1, 1, new Color(90, 220, 120, 255));
        this.bad = boxes.addBox(parent, 'GhostBad', 0, 0, 0, 1, 1, 1, new Color(230, 80, 80, 255));
        this.ok.active = false;
        this.bad.active = false;
    }

    /** rect 为 null 时隐藏。 */
    update(rect: Rect | null, height: number, valid: boolean): void {
        this.ok.active = rect !== null && valid;
        this.bad.active = rect !== null && !valid;
        if (!rect) return;
        const h = Math.max(height, 0.1);
        const node = valid ? this.ok : this.bad;
        node.setPosition(rect.x, h / 2, rect.z);
        node.setScale(rect.w, h, rect.d);
    }
}

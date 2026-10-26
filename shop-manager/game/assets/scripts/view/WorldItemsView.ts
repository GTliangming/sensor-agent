// 店里"会变化的东西"的 3D 表现:卸货区的纸箱和货车、货架/冷柜上的商品、玩家手里抱着的纸箱。
// 只读取 GameState 来显示;状态没变就不重建(用签名字符串判断)。仍是方块占位美术。
import { Color, Node } from 'cc';
import { ContainerKind, GOODS, getCatalogItem } from '../core/data/Catalog';
import type { Carton, GameState } from '../core/state/GameState';
import type { StoreLayout } from '../core/world/StoreLayout';
import { BoxFactory } from './BoxFactory';

/** 商品方块颜色:按目录里的顺序循环取色,相邻商品颜色不同,方便肉眼区分库存。 */
const GOODS_COLORS = [
    new Color(236, 96, 80, 255),
    new Color(250, 196, 60, 255),
    new Color(110, 180, 90, 255),
    new Color(70, 150, 230, 255),
    new Color(170, 110, 220, 255),
    new Color(240, 140, 180, 255),
    new Color(90, 200, 200, 255),
];

/** 纸箱颜色按"该放哪里"区分:货架类棕色、冷柜类蓝色、展柜类粉色、设备灰色。 */
const CARTON_COLORS: Record<ContainerKind | 'equipment', Color> = {
    shelf: new Color(190, 140, 90, 255),
    fridge: new Color(120, 170, 210, 255),
    glass: new Color(220, 150, 180, 255),
    equipment: new Color(140, 144, 156, 255),
};

const COLOR_TRUCK_BODY = new Color(236, 238, 242, 255);
const COLOR_TRUCK_CAB = new Color(60, 110, 200, 255);
const COLOR_WHEEL = new Color(40, 42, 48, 255);
const COLOR_TRASH = new Color(92, 88, 70, 255);

function clearChildren(node: Node): void {
    for (const child of node.children.slice()) {
        child.removeFromParent();
        child.destroy();
    }
}

function cartonColor(carton: Carton): Color {
    const item = getCatalogItem(carton.itemId);
    return item && item.kind === 'goods' ? CARTON_COLORS[item.container] : CARTON_COLORS.equipment;
}

export class WorldItemsView {
    private readonly cartonsRoot: Node;
    private readonly stockRoot: Node;
    private readonly truck: Node;
    private readonly hands: Node;
    private readonly trashRoot: Node;
    private sig = { cartons: '', stock: '', hands: '', trash: '' };
    /** 卸货区位置不随扩建变化,所以货车和纸箱可以直接用初始布局里的。 */
    private readonly layout: StoreLayout;

    constructor(
        parent: Node,
        cameraNode: Node,
        private readonly boxes: BoxFactory,
        initialLayout: StoreLayout,
    ) {
        this.layout = initialLayout;
        this.cartonsRoot = new Node('Cartons');
        this.stockRoot = new Node('Stock');
        this.trashRoot = new Node('Trash');
        this.truck = this.buildTruck();
        this.hands = new Node('HandsCarton');
        parent.addChild(this.cartonsRoot);
        parent.addChild(this.stockRoot);
        parent.addChild(this.trashRoot);
        parent.addChild(this.truck);
        cameraNode.addChild(this.hands); // 挂在相机下,跟着视角走
    }

    /** layout 是当前布局(摆放设备、扩建后会变)。 */
    update(state: GameState, layout: StoreLayout): void {
        const door = state.cartons.filter((c) => c.location === 'door');
        const cartonsSig = door.map((c) => `${c.id}:${c.itemId}`).join(',');
        if (cartonsSig !== this.sig.cartons) {
            this.sig.cartons = cartonsSig;
            this.rebuildCartons(door);
            this.truck.active = door.length > 0;
        }

        const layoutKey = layout.fixtures.map((f) => `${f.id}:${f.x}:${f.z}:${f.w}:${f.d}`).join('|');
        const stockSig = `${JSON.stringify(state.stock)}#${layoutKey}`;
        if (stockSig !== this.sig.stock) {
            this.sig.stock = stockSig;
            this.rebuildStock(state, layout);
        }

        const trashSig = state.trash.map((t) => `${t.id}:${t.x}:${t.z}`).join(',');
        if (trashSig !== this.sig.trash) {
            this.sig.trash = trashSig;
            clearChildren(this.trashRoot);
            for (const t of state.trash) this.boxes.addBox(this.trashRoot, `Trash_${t.id}`, t.x, 0.05, t.z, 0.3, 0.1, 0.24, COLOR_TRASH);
        }

        const held = state.cartons.find((c) => c.location === 'hands') ?? null;
        const handsSig = held ? `${held.id}:${held.itemId}` : '';
        if (handsSig !== this.sig.hands) {
            this.sig.hands = handsSig;
            clearChildren(this.hands);
            if (held) this.boxes.addBox(this.hands, 'Box', 0.3, -0.32, -0.7, 0.42, 0.3, 0.42, cartonColor(held));
        }
    }

    /** 卸货区里按网格摆放纸箱,超过两排就往上叠。 */
    private rebuildCartons(door: Carton[]): void {
        clearChildren(this.cartonsRoot);
        const z = this.layout.unloadZone;
        const cols = 4;
        const spacing = 0.9;
        door.forEach((c, i) => {
            const layer = Math.floor(i / (cols * 2));
            const slot = i % (cols * 2);
            const col = slot % cols;
            const row = Math.floor(slot / cols);
            const x = z.x - ((cols - 1) * spacing) / 2 + col * spacing;
            const pz = z.z - spacing / 2 + row * spacing;
            this.boxes.addBox(this.cartonsRoot, `Carton_${c.id}`, x, 0.25 + layer * 0.5, pz, 0.6, 0.5, 0.6, cartonColor(c));
        });
    }

    /** 每个货架/冷柜在正面按格子数摆商品方块,分三层,颜色代表商品种类。 */
    private rebuildStock(state: GameState, layout: StoreLayout): void {
        clearChildren(this.stockRoot);
        for (const f of layout.fixtures) {
            const contents = state.stock[f.id];
            if (!contents || !f.capacity) continue;

            const lat = { x: -f.front.z, z: f.front.x }; // 沿设施正面延伸的方向
            const halfDepth = Math.abs(f.front.x) * (f.w / 2) + Math.abs(f.front.z) * (f.d / 2);
            const halfLat = Math.abs(lat.x) * (f.w / 2) + Math.abs(lat.z) * (f.d / 2);
            const tiers = 3;
            const perTier = Math.max(1, Math.round(f.capacity / tiers));
            const margin = 0.12;
            const step = (2 * halfLat - 2 * margin) / perTier;
            const size = Math.min(step * 0.82, 0.22);

            let index = 0;
            for (const id of Object.keys(contents)) {
                const item = getCatalogItem(id);
                if (!item || item.kind !== 'goods') continue;
                const color = GOODS_COLORS[Math.max(0, GOODS.indexOf(item)) % GOODS_COLORS.length];
                const blocks = contents[id] * item.slots;
                for (let k = 0; k < blocks && index < f.capacity; k++, index++) {
                    const along = -halfLat + margin + step * ((index % perTier) + 0.5);
                    const out = halfDepth + size * 0.4 + 0.01;
                    const x = f.x + lat.x * along + f.front.x * out;
                    const z = f.z + lat.z * along + f.front.z * out;
                    const y = 0.3 + Math.floor(index / perTier) * 0.5 + size / 2;
                    this.boxes.addBox(this.stockRoot, `${id}_${index}`, x, y, z, size, size, size * 0.8, color);
                }
            }
        }
    }

    /** 停在卸货区旁边的一辆简易货车,有纸箱在地上时才显示。 */
    private buildTruck(): Node {
        const root = new Node('Truck');
        const z = this.layout.unloadZone;
        const x = z.x + z.w / 2 + 2.2; // 停在卸货区东侧
        const zc = z.z;
        this.boxes.addBox(root, 'Body', x, 1.4, zc + 0.9, 2.2, 2.2, 4.0, COLOR_TRUCK_BODY);
        this.boxes.addBox(root, 'Cab', x, 1.0, zc - 1.6, 2.2, 1.5, 1.4, COLOR_TRUCK_CAB);
        for (const dz of [-1.6, 1.6]) {
            for (const dx of [-1.1, 1.1]) this.boxes.addBox(root, 'Wheel', x + dx, 0.3, zc + dz, 0.25, 0.6, 0.6, COLOR_WHEEL);
        }
        root.active = false;
        return root;
    }
}

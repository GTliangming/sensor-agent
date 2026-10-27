// 店里"会变化的东西"的 3D 表现:卸货区的纸箱和货车、货架/冷柜上的商品、玩家手里抱着的纸箱。
// 只读取 GameState 来显示;状态没变就不重建(用签名字符串判断)。仍是方块占位美术。
import { Color, Node } from 'cc';
import { ContainerKind, GOODS, getCatalogItem } from '../core/data/Catalog';
import type { Carton, ContainerStock, GameState } from '../core/state/GameState';
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

/** 逐项比较两份库存(不产生临时对象):a 的每一项在 b 里都一样,并且 b 里没有多出来的项。 */
function sameStock(a: ContainerStock, b: ContainerStock): boolean {
    for (const f in a) {
        const x = a[f];
        const y = b[f];
        if (!y) return false;
        for (const id in x) if (y[id] !== x[id]) return false;
        for (const id in y) if (x[id] === undefined) return false;
    }
    for (const f in b) if (a[f] === undefined) return false;
    return true;
}

function cloneStock(a: ContainerStock): ContainerStock {
    const out: ContainerStock = {};
    for (const f in a) {
        const row: { [itemId: string]: number } = {};
        for (const id in a[f]) row[id] = a[f][id];
        out[f] = row;
    }
    return out;
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
    // 上一次画出来时的快照,用来判断要不要重建
    private doorIds: number[] = [];
    private doorItems: string[] = [];
    private stockSnap: ContainerStock = {};
    private fixturesRef: unknown = null;
    private trashKeys: string[] = [];
    private heldId = -1;
    private heldItem = '';
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

    /**
     * layout 是当前布局(摆放设备、扩建后会变)。
     * 每帧都会调用,所以变化检测不能产生垃圾:直接和上次的快照逐项比较,只有真的变了才重建并更新快照。
     */
    update(state: GameState, layout: StoreLayout): void {
        if (this.doorCartonsChanged(state)) {
            const door = state.cartons.filter((c) => c.location === 'door');
            this.doorIds = door.map((c) => c.id);
            this.doorItems = door.map((c) => c.itemId);
            this.rebuildCartons(door);
            this.truck.active = door.length > 0;
        }

        // 设施数组整体替换才算布局变化(见 GameSession.layout 的缓存),库存逐项比较
        if (layout.fixtures !== this.fixturesRef || !sameStock(state.stock, this.stockSnap)) {
            this.fixturesRef = layout.fixtures;
            this.stockSnap = cloneStock(state.stock);
            this.rebuildStock(state, layout);
        }

        if (this.trashChanged(state)) {
            this.trashKeys = state.trash.map((t) => `${t.id}:${t.x}:${t.z}`);
            clearChildren(this.trashRoot);
            for (const t of state.trash) this.boxes.addBox(this.trashRoot, `Trash_${t.id}`, t.x, 0.05, t.z, 0.3, 0.1, 0.24, COLOR_TRASH);
        }

        let held: Carton | null = null;
        for (const c of state.cartons) {
            if (c.location === 'hands') {
                held = c;
                break;
            }
        }
        const heldId = held ? held.id : -1;
        const heldItem = held ? held.itemId : '';
        if (heldId !== this.heldId || heldItem !== this.heldItem) {
            this.heldId = heldId;
            this.heldItem = heldItem;
            clearChildren(this.hands);
            if (held) this.boxes.addBox(this.hands, 'Box', 0.3, -0.32, -0.7, 0.42, 0.3, 0.42, cartonColor(held));
        }
    }

    private doorCartonsChanged(state: GameState): boolean {
        let k = 0;
        for (const c of state.cartons) {
            if (c.location !== 'door') continue;
            if (this.doorIds[k] !== c.id || this.doorItems[k] !== c.itemId) return true;
            k++;
        }
        return k !== this.doorIds.length;
    }

    private trashChanged(state: GameState): boolean {
        if (state.trash.length !== this.trashKeys.length) return true;
        for (let i = 0; i < state.trash.length; i++) {
            const t = state.trash[i];
            if (this.trashKeys[i] !== `${t.id}:${t.x}:${t.z}`) return true; // 垃圾很少(最多 12 处),比较时的字符串开销可以忽略
        }
        return false;
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

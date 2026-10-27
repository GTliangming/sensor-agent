// 根据店铺布局和外观主题,用基础几何体(方块)程序化生成 3D 场景。
// 货架、冷柜、展柜、堆头、收银机优先用 Kenney Mini Market 的低模(见 ModelLibrary),模型不可用时退回方块占位;
// 墙、地面、招牌仍是方块,因为它们的颜色要随外观主题变化。布局数据和玩法不受影响。
// 布局(设施、扩建)或主题变化后,整个店铺会销毁重建(只有几十个方块,开销很小)。
import { Color, Node } from 'cc';
import type { RGB, ThemeDef } from '../core/data/Catalog';
import type { Fixture, FixtureKind, Rect, StoreLayout } from '../core/world/StoreLayout';
import { BoxFactory } from './BoxFactory';
import { MODEL_SIZES, ModelLibrary } from './ModelLibrary';

const COLOR_STREET = new Color(96, 98, 104, 255);
const COLOR_DARK = new Color(50, 52, 60, 255);
const COLOR_SCREEN = new Color(70, 200, 255, 255);
const COLOR_ZONE = new Color(232, 190, 60, 255);

const KIND_COLORS: Record<FixtureKind, Color> = {
    shelf: new Color(222, 154, 84, 255),
    fridge: new Color(168, 206, 232, 255),
    glass: new Color(190, 226, 232, 255),
    counter: new Color(156, 104, 72, 255),
    computer: new Color(94, 96, 118, 255),
    decor: new Color(150, 150, 160, 255),
};

/** 个别设备有自己的颜色(优先于类型颜色)。 */
const EQUIP_COLORS: { [equipId: string]: Color } = {
    promo_stand: new Color(240, 150, 170, 255),
    extinguisher: new Color(210, 52, 52, 255),
    antislip_mat: new Color(240, 200, 60, 255),
    price_tag: new Color(250, 250, 250, 255),
    poster: new Color(96, 160, 230, 255),
    sign_light: new Color(255, 230, 120, 255),
    trash_bin: new Color(110, 120, 130, 255),
};

const rgb = (c: RGB) => new Color(c[0], c[1], c[2], 255);

function colorOfFixture(f: Fixture): Color {
    return (f.equipId && EQUIP_COLORS[f.equipId]) || KIND_COLORS[f.kind];
}

export class StoreBuilder {
    constructor(
        private readonly boxes: BoxFactory,
        private readonly models: ModelLibrary | null = null,
    ) {}

    /** 在 parent 下生成整个店铺,返回店铺根节点。 */
    build(layout: StoreLayout, theme: ThemeDef, parent: Node): Node {
        const root = new Node('Store');
        parent.addChild(root);

        // 街道地面(顶面在 y=0)与室内地面(顶面略高 1 厘米,避免两层重叠闪烁)
        this.addRect(root, 'Street', layout.worldBounds, -0.1, 0.1, COLOR_STREET);
        this.addRect(root, 'InteriorFloor', layout.interior, -0.09, 0.1, rgb(theme.floor));
        // 货车卸货区:地面上一块黄色标记
        this.addRect(root, 'UnloadZone', layout.unloadZone, 0, 0.02, COLOR_ZONE);

        const wallColor = rgb(theme.wall);
        layout.walls.forEach((w, i) => this.addRect(root, `Wall_${i}`, w, 0, layout.wallHeight, wallColor));

        // 踢脚线:每段墙脚下一圈比墙略宽的深色条,颜色取主题强调色压暗,让墙和地面有层次
        const baseboard = new Color(Math.round(theme.accent[0] * 0.55), Math.round(theme.accent[1] * 0.55), Math.round(theme.accent[2] * 0.55), 255);
        layout.walls.forEach((w, i) => {
            const strip: Rect = { x: w.x, z: w.z, w: w.w + 0.06, d: w.d + 0.06 };
            this.addRect(root, `Baseboard_${i}`, strip, 0, 0.18, baseboard);
        });

        // 门头招牌:横在门洞上方,颜色随主题
        const southZ = layout.interior.z + layout.interior.d / 2;
        this.boxes.addBox(root, 'Sign', 0, layout.wallHeight - 0.4, southZ + 0.3, 3.2, 0.7, 0.12, rgb(theme.accent));

        for (const f of layout.fixtures) {
            if (!this.addFixtureModel(root, f)) this.addRect(root, f.id, f, 0, f.height, colorOfFixture(f));
            this.addFixtureDetail(root, f.kind, f, f.height);
        }
        return root;
    }

    /** 设施用哪个模型:货架 / 堆头 / 冷柜 / 展柜有对应模型,其余(收银台、电脑桌、小装饰)没有。 */
    private modelNameOf(f: Fixture): string | null {
        if (f.kind === 'shelf') return f.equipId === 'promo_stand' ? 'display-fruit' : 'shelf-bags';
        if (f.kind === 'fridge') return 'freezers-standing';
        if (f.kind === 'glass') return 'display-bread';
        return null;
    }

    /**
     * 用模型表现一个设施:正面朝向对齐设施的 front,沿正面的方向(宽)和进深分别缩放到设施的占地,高度缩放到设施高度。
     * 成功返回 true;没有模型(或模型库没加载成功)返回 false,由调用方画方块。
     */
    private addFixtureModel(parent: Node, f: Fixture): boolean {
        const name = this.modelNameOf(f);
        if (!name) return false;
        // 设施的 w、d 是世界 x、z 方向的尺寸;正面朝 ±x 时,"宽"沿 z、"进深"沿 x
        const sideways = f.front.x !== 0;
        const width = sideways ? f.d : f.w;
        const depth = sideways ? f.w : f.d;
        const yaw = (Math.atan2(f.front.x, f.front.z) * 180) / Math.PI;
        return this.placeModel(parent, name, f.x, 0, f.z, width, f.height, depth, yaw, true) !== null;
    }

    /**
     * 放一个模型。dimsAreTarget 为 true 时 (sx, sy, sz) 是目标尺寸(米,按模型原始尺寸换算成缩放);
     * 否则它们直接是缩放倍数。没有该模型返回 null。
     */
    private placeModel(parent: Node, name: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yawDeg: number, dimsAreTarget = false): Node | null {
        const node = this.models ? this.models.create(name) : null;
        const size = MODEL_SIZES[name];
        if (!node || !size) return null;
        node.setPosition(x, y, z);
        node.setRotationFromEuler(0, yawDeg, 0);
        if (dimsAreTarget) node.setScale(sx / size.x, sy / size.y, sz / size.z);
        else node.setScale(sx, sy, sz);
        parent.addChild(node);
        return node;
    }

    /** 给个别设施加一点辨识度细节(收银机、电脑屏幕)。 */
    private addFixtureDetail(parent: Node, kind: FixtureKind, r: Rect, top: number): void {
        if (kind === 'counter') {
            const register = this.placeModel(parent, 'cash-register', r.x - 0.5, top, r.z, 0.55, 0.55, 0.55, 180);
            if (!register) this.boxes.addBox(parent, 'Register', r.x - 0.5, top + 0.12, r.z, 0.4, 0.24, 0.35, COLOR_DARK);
        } else if (kind === 'computer') {
            this.boxes.addBox(parent, 'Screen', r.x, top + 0.3, r.z - 0.1, 0.55, 0.38, 0.05, COLOR_SCREEN);
            this.boxes.addBox(parent, 'ScreenStand', r.x, top + 0.06, r.z - 0.1, 0.12, 0.12, 0.12, COLOR_DARK);
        }
    }

    /** 以矩形占地、从 baseY 起向上 height 米生成一个方块。 */
    private addRect(parent: Node, name: string, r: Rect, baseY: number, height: number, color: Color): Node {
        return this.boxes.addBox(parent, name, r.x, baseY + height / 2, r.z, r.w, height, r.d, color);
    }
}

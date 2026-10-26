// 根据店铺布局和外观主题,用基础几何体(方块)程序化生成 3D 场景。
// 这是占位美术:后续换成低模模型时,只需要替换这里的生成逻辑,布局数据和玩法不受影响。
// 布局(设施、扩建)或主题变化后,整个店铺会销毁重建(只有几十个方块,开销很小)。
import { Color, Node } from 'cc';
import type { RGB, ThemeDef } from '../core/data/Catalog';
import type { Fixture, FixtureKind, Rect, StoreLayout } from '../core/world/StoreLayout';
import { BoxFactory } from './BoxFactory';

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
    constructor(private readonly boxes: BoxFactory) {}

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

        // 门头招牌:横在门洞上方,颜色随主题
        const southZ = layout.interior.z + layout.interior.d / 2;
        this.boxes.addBox(root, 'Sign', 0, layout.wallHeight - 0.4, southZ + 0.3, 3.2, 0.7, 0.12, rgb(theme.accent));

        for (const f of layout.fixtures) {
            this.addRect(root, f.id, f, 0, f.height, colorOfFixture(f));
            this.addFixtureDetail(root, f.kind, f, f.height);
        }
        return root;
    }

    /** 给个别设施加一点辨识度细节(收银机、电脑屏幕)。 */
    private addFixtureDetail(parent: Node, kind: FixtureKind, r: Rect, top: number): void {
        if (kind === 'counter') {
            this.boxes.addBox(parent, 'Register', r.x - 0.5, top + 0.12, r.z, 0.4, 0.24, 0.35, COLOR_DARK);
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

// 根据店铺布局数据,用基础几何体(方块)程序化生成 3D 场景。
// 这是占位美术:后续换成低模模型时,只需要替换这里的生成逻辑,布局数据和玩法不受影响。
import { Color, Material, Mesh, MeshRenderer, Node, primitives, utils } from 'cc';
import type { FixtureKind, Rect, StoreLayout } from '../core/world/StoreLayout';

const COLOR_STREET = new Color(96, 98, 104, 255);
const COLOR_FLOOR = new Color(236, 224, 198, 255);
const COLOR_WALL = new Color(247, 243, 235, 255);
const COLOR_DARK = new Color(50, 52, 60, 255);
const COLOR_SCREEN = new Color(70, 200, 255, 255);

const FIXTURE_COLORS: Record<FixtureKind, Color> = {
    shelf: new Color(222, 154, 84, 255),
    fridge: new Color(168, 206, 232, 255),
    counter: new Color(156, 104, 72, 255),
    computer: new Color(94, 96, 118, 255),
};

export class StoreBuilder {
    /** 所有方块共用一个单位立方体网格,靠节点缩放得到不同尺寸。 */
    private readonly unitBox: Mesh = utils.MeshUtils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
    private readonly materials = new Map<string, Material>();

    /**
     * @param baseMaterial 基础材质(来自 resources/materials/block)。
     * 不在代码里按名字创建材质:内置 Effect 不一定已被加载,通过资源引用加载才能保证它存在,打包时也会被带上。
     */
    constructor(private readonly baseMaterial: Material) {}

    /** 在 parent 下生成整个店铺,返回店铺根节点。 */
    build(layout: StoreLayout, parent: Node): Node {
        const root = new Node('Store');
        parent.addChild(root);

        // 街道地面(顶面在 y=0)与室内地面(顶面略高 1 厘米,避免两层重叠闪烁)
        this.addRect(root, 'Street', layout.worldBounds, -0.1, 0.1, COLOR_STREET);
        this.addRect(root, 'InteriorFloor', layout.interior, -0.09, 0.1, COLOR_FLOOR);

        layout.walls.forEach((w, i) => this.addRect(root, `Wall_${i}`, w, 0, layout.wallHeight, COLOR_WALL));

        for (const f of layout.fixtures) {
            this.addRect(root, f.id, f, 0, f.height, FIXTURE_COLORS[f.kind]);
            this.addFixtureDetail(root, f.kind, f, f.height);
        }
        return root;
    }

    /** 给个别设施加一点辨识度细节(收银机、电脑屏幕)。 */
    private addFixtureDetail(parent: Node, kind: FixtureKind, r: Rect, top: number): void {
        if (kind === 'counter') {
            this.addBox(parent, 'Register', r.x - 0.5, top + 0.12, r.z, 0.4, 0.24, 0.35, COLOR_DARK);
        } else if (kind === 'computer') {
            this.addBox(parent, 'Screen', r.x, top + 0.3, r.z - 0.1, 0.55, 0.38, 0.05, COLOR_SCREEN);
            this.addBox(parent, 'ScreenStand', r.x, top + 0.06, r.z - 0.1, 0.12, 0.12, 0.12, COLOR_DARK);
        }
    }

    /** 以矩形占地、从 baseY 起向上 height 米生成一个方块。 */
    private addRect(parent: Node, name: string, r: Rect, baseY: number, height: number, color: Color): Node {
        return this.addBox(parent, name, r.x, baseY + height / 2, r.z, r.w, height, r.d, color);
    }

    private addBox(parent: Node, name: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color): Node {
        const node = new Node(name);
        node.setPosition(cx, cy, cz);
        node.setScale(sx, sy, sz);
        const renderer = node.addComponent(MeshRenderer);
        renderer.mesh = this.unitBox;
        renderer.material = this.getMaterial(color);
        parent.addChild(node);
        return node;
    }

    private getMaterial(color: Color): Material {
        const key = `${color.r},${color.g},${color.b},${color.a}`;
        let mat = this.materials.get(key);
        if (!mat) {
            mat = new Material();
            mat.copy(this.baseMaterial);
            mat.setProperty('mainColor', color);
            this.materials.set(key, mat);
        }
        return mat;
    }
}

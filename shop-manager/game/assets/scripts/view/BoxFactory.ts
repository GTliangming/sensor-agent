// 方块工厂:所有占位美术(店铺墙体、货架、纸箱、商品)都由它生成。
// 共用一个单位立方体网格,靠节点缩放得到不同尺寸;同色方块共用一个材质。
import { Color, Material, Mesh, MeshRenderer, Node, primitives, utils } from 'cc';

export class BoxFactory {
    private readonly unitBox: Mesh = utils.MeshUtils.createMesh(primitives.box({ width: 1, height: 1, length: 1 }));
    private readonly materials = new Map<string, Material>();

    /**
     * @param baseMaterial 基础材质(来自 resources/materials/block)。
     * 不在代码里按名字创建材质:内置 Effect 不一定已被加载,通过资源引用加载才能保证它存在,打包时也会被带上。
     */
    constructor(private readonly baseMaterial: Material) {}

    /** 在 parent 下创建一个以 (cx, cy, cz) 为中心、尺寸 (sx, sy, sz) 的方块。 */
    addBox(parent: Node, name: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: Color): Node {
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

// 模型库:启动时从 resources/models 下加载 3D 模型(glTF/GLB 导入后生成的预制体),按名字取用。
// 加载失败或某个模型不存在时,调用方继续用方块占位,游戏照常运行。
// 模型来源:Kenney Mini Market(CC0),授权文件见 resources/models/market。
import { Node, Prefab, instantiate, resources } from 'cc';

/**
 * 模型的原始尺寸(米,来自 GLB 的包围盒;原点在底面中心,正面朝 +z)。
 * 摆进店里时按设施的占地和高度做非等比缩放,所以只需要这三个数。
 */
export interface ModelSize {
    x: number;
    y: number;
    z: number;
}

export const MODEL_SIZES: { [name: string]: ModelSize } = {
    'shelf-bags': { x: 0.8, y: 0.8, z: 0.7 },
    'display-fruit': { x: 0.6, y: 0.52, z: 0.6 },
    'freezers-standing': { x: 1.0, y: 0.9, z: 0.5 },
    'display-bread': { x: 0.7, y: 0.5, z: 0.6 },
    'cash-register': { x: 0.85, y: 0.59, z: 0.85 },
};

export class ModelLibrary {
    private readonly prefabs = new Map<string, Prefab>();

    /** 加载 resources/models 下所有预制体;无论成功与否都会回调(失败时库是空的)。 */
    static load(onDone: (lib: ModelLibrary) => void): void {
        const lib = new ModelLibrary();
        resources.loadDir('models', Prefab, (err, assets) => {
            if (err || !assets) {
                console.warn('[ModelLibrary] 加载 resources/models 失败,继续使用方块占位', err);
            } else {
                for (const p of assets) lib.prefabs.set(p.name, p);
                console.log(`[ModelLibrary] 已加载 ${lib.prefabs.size} 个模型:${Array.from(lib.prefabs.keys()).join('、')}`);
            }
            onDone(lib);
        });
    }

    has(name: string): boolean {
        return this.prefabs.has(name);
    }

    /** 创建一个模型实例(没有这个模型返回 null)。 */
    create(name: string): Node | null {
        const p = this.prefabs.get(name);
        return p ? instantiate(p) : null;
    }
}

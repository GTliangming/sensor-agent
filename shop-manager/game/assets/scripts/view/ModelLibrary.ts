// 模型库:启动时从 resources/models 下加载 3D 模型(glTF/GLB 导入后生成的预制体),按名字取用。
// 加载失败或某个模型不存在时,调用方继续用方块占位,游戏照常运行。
// 模型来源:Kenney Mini Market 与 Food Kit(CC0),授权文件见 resources/models 下各子目录。
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
    // 商品(Kenney Food Kit,resources/models/food)
    bag: { x: 0.31, y: 0.84, z: 0.58 },
    cookie: { x: 0.22, y: 0.05, z: 0.19 },
    chocolate: { x: 0.29, y: 0.03, z: 0.15 },
    'soda-can': { x: 0.22, y: 0.35, z: 0.22 },
    'soda-bottle': { x: 0.18, y: 0.58, z: 0.16 },
    carton: { x: 0.23, y: 0.59, z: 0.23 },
    'ice-cream': { x: 0.33, y: 0.3, z: 0.38 },
    'dim-sum': { x: 0.16, y: 0.12, z: 0.19 },
    apple: { x: 0.2, y: 0.19, z: 0.2 },
    cabbage: { x: 0.38, y: 0.31, z: 0.4 },
    'bag-flat': { x: 0.65, y: 0.19, z: 0.47 },
    'bottle-oil': { x: 0.14, y: 0.62, z: 0.14 },
    loaf: { x: 0.58, y: 0.44, z: 0.37 },
    cake: { x: 0.83, y: 0.27, z: 0.8 },
};

/** 商品 id -> 占位商品模型(Food Kit 里没有的商品用最接近的东西代替,正式美术到位后再换)。 */
export const GOODS_MODELS: { [goodsId: string]: string } = {
    chips: 'bag',
    biscuit: 'cookie',
    chocolate: 'chocolate',
    cola: 'soda-can',
    water: 'soda-bottle',
    juice: 'carton',
    icecream: 'ice-cream',
    dumpling: 'dim-sum',
    apple: 'apple',
    greens: 'cabbage',
    tissue: 'bag-flat',
    detergent: 'bottle-oil',
    bread: 'loaf',
    cake: 'cake',
};

export class ModelLibrary {
    private readonly prefabs = new Map<string, Prefab>();

    /**
     * 加载 resources/models 下所有预制体;无论成功与否都会回调(失败时库是空的)。
     * 不用 loadDir 直接取名字:GLB 生成的预制体自身的 name 是空的,按名字存会互相覆盖,所以改用资源路径的最后一段当名字。
     */
    static load(onDone: (lib: ModelLibrary) => void): void {
        const lib = new ModelLibrary();
        const infos = resources.getDirWithPath('models', Prefab);
        if (infos.length === 0) {
            console.warn('[ModelLibrary] resources/models 下没有找到预制体,继续使用方块占位');
            onDone(lib);
            return;
        }
        let left = infos.length;
        const finish = () => {
            left--;
            if (left > 0) return;
            console.log(`[ModelLibrary] 已加载 ${lib.prefabs.size}/${infos.length} 个模型:${Array.from(lib.prefabs.keys()).join('、')}`);
            onDone(lib);
        };
        for (const info of infos) {
            const parts = info.path.split('/');
            const name = parts[parts.length - 1];
            resources.load(info.path, Prefab, (err, prefab) => {
                if (err || !prefab) console.warn(`[ModelLibrary] 加载 ${info.path} 失败`, err);
                else lib.prefabs.set(name, prefab);
                finish();
            });
        }
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

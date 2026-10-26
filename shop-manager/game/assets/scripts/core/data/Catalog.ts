// 采购目录:商品与设备的静态配置。数值是占位的初版,调平衡时只改这里。
// 目前用 TS 常量;等有了统一的配置加载器,再迁移成 assets/data 下的 JSON。

/** 储存容器:决定商品只能放在哪种设备里(放错顾客不拿,见步骤 4)。 */
export type ContainerKind = 'shelf' | 'fridge' | 'glass';

export interface GoodsDef {
    kind: 'goods';
    id: string;
    name: string;
    category: string;
    container: ContainerKind;
    /** 进货价(每件)与售价(每件)。 */
    unitCost: number;
    unitPrice: number;
    /** 每件占用的货架格子数。 */
    slots: number;
    /** 一批包含多少件。 */
    batchSize: number;
    unlockLevel: number;
}

/** 设备摆进店里时的外形与行为(朝向为 0 时:正面朝 +z,宽沿 x,深沿 z;旋转 90 度时宽深互换)。 */
export interface PlacementDef {
    /** 摆进店里后的设施类型。 */
    kind: 'shelf' | 'fridge' | 'glass' | 'decor';
    w: number;
    d: number;
    height: number;
    /** 容器类设备可存放的格子数。 */
    capacity?: number;
    /** 是否挡路。地垫、海报、灭火器这类小物件不挡路。 */
    collides: boolean;
}

export interface EquipmentDef {
    kind: 'equipment';
    id: string;
    name: string;
    description: string;
    price: number;
    unlockLevel: number;
    placement: PlacementDef;
}

export type CatalogItem = GoodsDef | EquipmentDef;

/** 下单后多少游戏内分钟送达。 */
export const DELIVERY_GAME_MINUTES = 90;
/** 单张订单最多订多少批/件。 */
export const MAX_ORDER_QUANTITY = 20;
/** 金币不足时,看一次广告获得的金币(开发期占位值,真实广告在步骤 15 接入)。 */
export const AD_COIN_REWARD = 200;

export const CONTAINER_NAMES: Record<ContainerKind, string> = {
    shelf: '普通货架',
    fridge: '冷柜',
    glass: '玻璃展柜',
};

const goods = (
    id: string,
    name: string,
    category: string,
    container: ContainerKind,
    unitCost: number,
    unitPrice: number,
    slots: number,
    batchSize: number,
    unlockLevel: number,
): GoodsDef => ({ kind: 'goods', id, name, category, container, unitCost, unitPrice, slots, batchSize, unlockLevel });

const equipment = (
    id: string,
    name: string,
    description: string,
    price: number,
    unlockLevel: number,
    placement: PlacementDef,
): EquipmentDef => ({ kind: 'equipment', id, name, description, price, unlockLevel, placement });

export const GOODS: GoodsDef[] = [
    goods('chips', '薯片', '零食', 'shelf', 3, 5, 1, 12, 1),
    goods('biscuit', '饼干', '零食', 'shelf', 2, 4, 1, 12, 1),
    goods('chocolate', '巧克力', '零食', 'shelf', 4, 7, 1, 10, 2),
    goods('cola', '可乐', '饮料', 'shelf', 2, 4, 1, 12, 1),
    goods('water', '矿泉水', '饮料', 'shelf', 1, 3, 1, 12, 1),
    goods('juice', '果汁', '饮料', 'shelf', 3, 6, 1, 10, 2),
    goods('icecream', '雪糕', '冷冻品', 'fridge', 3, 6, 1, 10, 1),
    goods('dumpling', '速冻水饺', '冷冻品', 'fridge', 8, 14, 2, 6, 2),
    goods('apple', '苹果', '生鲜', 'fridge', 2, 4, 1, 12, 3),
    goods('greens', '青菜', '生鲜', 'fridge', 1, 3, 1, 12, 3),
    goods('tissue', '纸巾', '日用百货', 'shelf', 2, 4, 1, 12, 2),
    goods('detergent', '洗衣液', '日用百货', 'shelf', 10, 16, 2, 6, 3),
    goods('bread', '面包', '糕点', 'glass', 3, 6, 1, 8, 2),
    goods('cake', '蛋糕', '糕点', 'glass', 6, 12, 1, 6, 2),
];

export const EQUIPMENT: EquipmentDef[] = [
    equipment('shelf', '普通货架', '多一组货架,多摆商品', 300, 1, { kind: 'shelf', w: 2.2, d: 0.6, height: 1.8, capacity: 24, collides: true }),
    equipment('fridge', '冷柜', '雪糕、生鲜必须放冷柜', 600, 1, { kind: 'fridge', w: 2.0, d: 0.8, height: 1.9, capacity: 18, collides: true }),
    equipment('glass_case', '玻璃展柜', '糕点专用', 500, 2, { kind: 'glass', w: 1.6, d: 0.6, height: 1.1, capacity: 12, collides: true }),
    equipment('promo_stand', '堆头', '促销陈列,可放普通商品', 400, 2, { kind: 'shelf', w: 1.2, d: 1.2, height: 1.0, capacity: 12, collides: true }),
    equipment('extinguisher', '灭火器', '冒烟时用来灭火', 120, 1, { kind: 'decor', w: 0.3, d: 0.3, height: 0.5, collides: false }),
    equipment('antislip_mat', '防滑垫', '暴雨天防止门口打滑差评', 80, 1, { kind: 'decor', w: 1.2, d: 0.8, height: 0.03, collides: false }),
    equipment('price_tag', '价签', '让货架更整洁', 30, 1, { kind: 'decor', w: 0.25, d: 0.25, height: 0.3, collides: false }),
    equipment('poster', '海报', '装饰与促销', 60, 1, { kind: 'decor', w: 1.0, d: 0.1, height: 1.0, collides: false }),
    equipment('sign_light', '灯牌', '夜间更显眼', 150, 3, { kind: 'decor', w: 0.6, d: 0.1, height: 0.4, collides: false }),
    equipment('trash_bin', '垃圾桶', '减少垃圾堆积', 40, 1, { kind: 'decor', w: 0.4, d: 0.4, height: 0.6, collides: true }),
];

/** 扩建:下标 = 扩建后的等级(0 是初始小店)。店内尺寸见 core/world/StoreLayout 的 EXPANSION_SIZES。 */
export const EXPANSIONS: ReadonlyArray<{ name: string; cost: number; unlockLevel: number }> = [
    { name: '街边小店', cost: 0, unlockLevel: 1 },
    { name: '中型超市', cost: 1500, unlockLevel: 3 },
    { name: '大型商超', cost: 5000, unlockLevel: 5 },
];

export type RGB = [number, number, number];

/** 外观主题:只改外观(墙、地面、门头招牌颜色),没有任何收益加成。 */
export interface ThemeDef {
    id: string;
    name: string;
    wall: RGB;
    floor: RGB;
    accent: RGB;
    /** 解锁需要的超市等级;默认主题免费,其余都要先看广告。 */
    unlockLevel: number;
    free?: boolean;
}

export const DEFAULT_THEME_ID = 'street';

export const THEMES: ThemeDef[] = [
    { id: 'street', name: '街边小店', wall: [247, 243, 235], floor: [236, 224, 198], accent: [210, 120, 60], unlockLevel: 1, free: true },
    { id: 'japan', name: '日系便利店', wall: [250, 252, 255], floor: [226, 232, 238], accent: [60, 170, 120], unlockLevel: 1 },
    { id: 'retro', name: '复古小卖部', wall: [232, 214, 178], floor: [168, 130, 96], accent: [168, 60, 52], unlockLevel: 1 },
    { id: 'farm', name: '田园生鲜风', wall: [236, 244, 224], floor: [206, 196, 160], accent: [96, 160, 70], unlockLevel: 3 },
    { id: 'luxe', name: '轻奢精品超市', wall: [236, 232, 228], floor: [60, 62, 70], accent: [196, 164, 90], unlockLevel: 4 },
    { id: 'cyber', name: '赛博便利店', wall: [60, 64, 90], floor: [36, 38, 56], accent: [60, 230, 220], unlockLevel: 5 },
];

export function getTheme(id: string): ThemeDef {
    return THEMES.filter((t) => t.id === id)[0] ?? THEMES[0];
}

const BY_ID: { [id: string]: CatalogItem } = {};
for (const item of GOODS) BY_ID[item.id] = item;
for (const item of EQUIPMENT) BY_ID[`equip:${item.id}`] = item;

/** 目录 key:商品直接用 id,设备加 "equip:" 前缀(商品与设备的 id 可能重名,如 shelf / fridge)。 */
export function catalogKey(item: CatalogItem): string {
    return item.kind === 'equipment' ? `equip:${item.id}` : item.id;
}

export function getCatalogItem(key: string): CatalogItem | undefined {
    return BY_ID[key];
}

/** 订购一批(商品)或一件(设备)需要的金币。 */
export function unitOrderCost(item: CatalogItem): number {
    return item.kind === 'goods' ? item.unitCost * item.batchSize : item.price;
}

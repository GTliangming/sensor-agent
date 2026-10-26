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

export interface EquipmentDef {
    kind: 'equipment';
    id: string;
    name: string;
    description: string;
    price: number;
    unlockLevel: number;
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

const equipment = (id: string, name: string, description: string, price: number, unlockLevel: number): EquipmentDef => ({
    kind: 'equipment',
    id,
    name,
    description,
    price,
    unlockLevel,
});

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
    equipment('shelf', '普通货架', '多一组货架,多摆商品', 300, 1),
    equipment('fridge', '冷柜', '雪糕、生鲜必须放冷柜', 600, 1),
    equipment('glass_case', '玻璃展柜', '糕点专用', 500, 2),
    equipment('promo_stand', '堆头', '促销陈列', 400, 2),
    equipment('extinguisher', '灭火器', '冒烟时用来灭火', 120, 1),
    equipment('antislip_mat', '防滑垫', '暴雨天防止门口打滑差评', 80, 1),
    equipment('price_tag', '价签', '让货架更整洁', 30, 1),
    equipment('poster', '海报', '装饰与促销', 60, 1),
    equipment('sign_light', '灯牌', '夜间更显眼', 150, 3),
    equipment('trash_bin', '垃圾桶', '减少垃圾堆积', 40, 1),
];

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

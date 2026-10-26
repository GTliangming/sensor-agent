// 全局游戏状态:对应《模拟超市.docx》里的核心资源。整个存档就是它的 JSON。
// 后续步骤(库存、员工……)新增的数据也放进来,并同步升级存档版本(见 core/save/SaveGame.ts)。

export type OrderStatus = 'delivering' | 'arrived';

/** 一张采购订单。 */
export interface Order {
    id: number;
    /** 对应 core/data/Catalog 里的商品或设备 id。 */
    itemId: string;
    /** 商品:订购的批数;设备:订购的件数。 */
    quantity: number;
    /** 下单时已扣除的金币。 */
    cost: number;
    status: OrderStatus;
    /** 下单与预计送达的时刻(游戏内累计分钟,见 absoluteMinutes)。 */
    placedAtMinute: number;
    arriveAtMinute: number;
}

export interface GameState {
    /** 金币:唯一货币。 */
    coins: number;
    /** 满意度 0~100,直接影响客流量。 */
    satisfaction: number;
    /** 超市等级。 */
    level: number;
    /** 第几个游戏日,从 1 开始。 */
    day: number;
    /** 当天进度 0~1(不含 1),0 = 一天开始。 */
    timeOfDay: number;
    /** 是否开门营业(开门后才会刷新顾客)。 */
    isOpen: boolean;
    /** 采购订单(配送中与已到货、尚未被搬进店内的)。 */
    orders: Order[];
    /** 下一张订单的编号。 */
    nextOrderId: number;
}

/** 新游戏的初始状态。 */
export function createInitialState(): GameState {
    return {
        coins: 500,
        satisfaction: 60,
        level: 1,
        day: 1,
        timeOfDay: 0,
        isOpen: false,
        orders: [],
        nextOrderId: 1,
    };
}

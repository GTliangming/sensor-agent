// 全局游戏状态:对应《模拟超市.docx》里的核心资源。整个存档就是它的 JSON。
// 新增数据时同步升级存档版本并写迁移(见 core/save/SaveGame.ts)。

import { Rng } from '../base/Rng';
import { DEFAULT_THEME_ID } from '../data/Catalog';
import { WeatherKind, rollWeather } from '../events/Weather';
import { Fixture, initialFixtures } from '../world/StoreLayout';

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

/**
 * 一个纸箱。送达的订单会在卸货区生成一个纸箱;玩家搬起后放进货架,或(设备)收进仓库。
 * 从货架上拿起的商品也装在纸箱里(orderId 为 null)。
 */
export interface Carton {
    id: number;
    /** 来源订单;从货架拿下来的为 null。 */
    orderId: number | null;
    itemId: string;
    /** 剩余件数(商品为单件数量,设备为件数)。 */
    units: number;
    /** door = 在卸货区地上;hands = 玩家抱在手里(同一时间最多一个)。 */
    location: 'door' | 'hands';
    /** 还能获得"上架经验"的件数。只有新到货的商品有,防止把货架上的货拿下来再放上去刷经验。 */
    xpLeft: number;
}

/** 货架/冷柜里的库存:fixtureId -> (商品 id -> 件数)。 */
export type ContainerStock = { [fixtureId: string]: { [itemId: string]: number } };

/** 顾客想买的一样东西。 */
export interface WantLine {
    itemId: string;
    units: number;
}

/** 顾客购物车里的一行,记着从哪个货架拿的(被赶走或离开时好放回去)。 */
export interface CartLine {
    itemId: string;
    units: number;
    fixtureId: string;
}

export type CustomerPhase = 'browsing' | 'queuing';

/**
 * 一位顾客。核心层只记录"状态与计时",不记录位置;3D 里走到哪由表现层根据状态推算。
 * 这样顾客的行为是确定的、可存档、可单元测试。
 */
export interface Customer {
    id: number;
    phase: CustomerPhase;
    /** 逛店阶段:剩余逛的秒数;排队阶段:剩余耐心秒数。 */
    timer: number;
    /** 已经排队等了多少秒。 */
    waited: number;
    wants: WantLine[];
    cart: CartLine[];
    /** 收银员是否已经扫过码。 */
    scanned: boolean;
    /** 进入队列的先后序号(越小越靠前);逛店时为 0。 */
    joinSeq: number;
}

/** 当天的经营统计,日结算时生成日报。 */
export interface DayStats {
    day: number;
    revenue: number;
    served: number;
    lost: number;
    /** 商品 id -> 卖出件数。 */
    sold: { [itemId: string]: number };
    /** 商品 id -> 顾客想买却没货的次数。 */
    missed: { [itemId: string]: number };
    satisfactionStart: number;
}

export interface DayReport {
    day: number;
    revenue: number;
    served: number;
    lost: number;
    soldUnits: number;
    bestSeller: string | null;
    /** 缺货最多的几样商品 id(最多 3 个)。 */
    missed: string[];
    satisfactionStart: number;
    satisfactionEnd: number;
}

/** 地上的一处垃圾。顾客逛店后会留下,玩家走过去清扫;堆多了会拉低满意度。 */
export interface TrashPiece {
    id: number;
    x: number;
    z: number;
}

export type EventType = 'rain_puddle' | 'heat_fridge' | 'wind_sign' | 'supplier_discount' | 'expiring' | 'blackout';

/** 一个等待玩家处理的突发事件,有倒计时。 */
export interface ActiveEvent {
    id: number;
    type: EventType;
    /** 与某件商品相关的事件(如"快过期")记录商品 id。 */
    itemId: string | null;
    remainingSec: number;
    totalSec: number;
}

/** 限时价格系数,到 untilDay(含)当天结束为止有效。 */
export interface PriceFactor {
    factor: number;
    untilDay: number;
}

/** 新手引导进度。step 到达步骤总数即为完成。 */
export interface TutorialState {
    step: number;
    /** 玩家是否已经走动过(由表现层汇报)。 */
    moved: boolean;
}

export interface GameState {
    /** 金币:唯一货币。 */
    coins: number;
    /** 满意度 0~100,直接影响客流量。 */
    satisfaction: number;
    /** 超市等级。 */
    level: number;
    /** 累计经验值。 */
    xp: number;
    /** 第几个游戏日,从 1 开始。 */
    day: number;
    /** 当天进度 0~1(不含 1),0 = 一天开始。 */
    timeOfDay: number;
    /** 是否开门营业(开门后才会刷新顾客)。 */
    isOpen: boolean;
    /** 采购订单(配送中与已到货、尚未被搬进店内的)。 */
    orders: Order[];
    nextOrderId: number;
    /** 已送达、还没处理完的纸箱。 */
    cartons: Carton[];
    nextCartonId: number;
    /** 各货架/冷柜里的商品。 */
    stock: ContainerStock;
    /** 仓库里存放的、尚未摆进店里的设备:设备 id -> 件数(摆放在步骤 8)。 */
    warehouse: { [equipmentId: string]: number };
    /** 店里的顾客。 */
    customers: Customer[];
    nextCustomerId: number;
    /** 下一位进入队列的顾客序号。 */
    nextQueueSeq: number;
    /** 顾客生成的累积进度(满 1 生成一位)。 */
    spawnProgress: number;
    /** 伪随机数状态,存进档里读档后序列继续,行为可复现。 */
    rngState: number;
    /** 累计成功收银的顾客数。 */
    totalServed: number;
    today: DayStats;
    /** 等待玩家查看的日报;看完设为 null。 */
    pendingReport: DayReport | null;
    tutorial: TutorialState;
    /** 店内设施(货架、冷柜、收银台……),玩家可以搬动其中 movable 的。 */
    fixtures: Fixture[];
    nextFixtureId: number;
    /** 扩建等级,0 = 初始小店。 */
    expansion: number;
    /** 当前外观主题与已解锁的主题。 */
    theme: string;
    unlockedThemes: string[];
    trash: TrashPiece[];
    nextTrashId: number;
    /** 今天的天气,以及接下来两天的预报(在电脑里查看)。 */
    weather: WeatherKind;
    forecast: WeatherKind[];
    events: ActiveEvent[];
    nextEventId: number;
    /** 距离下一次可能触发事件还有多少秒。 */
    eventCooldown: number;
    /** 商品促销价(临期打折):商品 id -> 价格系数。 */
    priceFactors: { [itemId: string]: PriceFactor };
    /** 供货商限时打折:进货价乘以该系数。 */
    supplierDiscount: PriceFactor | null;
}

export function createDayStats(day: number, satisfaction: number): DayStats {
    return { day, revenue: 0, served: 0, lost: 0, sold: {}, missed: {}, satisfactionStart: satisfaction };
}

/** 新游戏的初始状态。seed 决定顾客与随机事件的序列,新游戏由调用方传入随机种子。 */
export function createInitialState(seed = 20261026): GameState {
    const state: GameState = {
        coins: 500,
        satisfaction: 60,
        level: 1,
        xp: 0,
        day: 1,
        timeOfDay: 0,
        isOpen: false,
        orders: [],
        nextOrderId: 1,
        cartons: [],
        nextCartonId: 1,
        stock: {},
        warehouse: {},
        customers: [],
        nextCustomerId: 1,
        nextQueueSeq: 1,
        spawnProgress: 0,
        rngState: seed | 0,
        totalServed: 0,
        today: createDayStats(1, 60),
        pendingReport: null,
        tutorial: { step: 0, moved: false },
        fixtures: initialFixtures(),
        nextFixtureId: 1,
        expansion: 0,
        theme: DEFAULT_THEME_ID,
        unlockedThemes: [DEFAULT_THEME_ID],
        trash: [],
        nextTrashId: 1,
        weather: 'clear',
        forecast: ['clear', 'clear'],
        events: [],
        nextEventId: 1,
        eventCooldown: 60,
        priceFactors: {},
        supplierDiscount: null,
    };
    // 天气由种子决定:第 1 天固定晴天,预报第 2、3 天
    const rng = new Rng(state);
    state.forecast = [rollWeather(rng, 2), rollWeather(rng, 3)];
    return state;
}

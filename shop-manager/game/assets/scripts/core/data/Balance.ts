// 经营数值配置:顾客、满意度、经验。占位的初版数值,调平衡时只改这里。

export const CUSTOMER = {
    /** 店里同时最多几位顾客(含排队)。 */
    maxInStore: 6,
    /** 收银台前最多排几位,满了新来的顾客直接走。 */
    queueCap: 5,
    /** 逛店时间(秒)。 */
    browseMin: 6,
    browseMax: 10,
    /** 排队耐心(秒):超过没人收银就生气离开。 */
    queuePatience: 40,
    /** 客流:每分钟来多少位 = 基础 + 满意度/100 × 每满意度增量。 */
    spawnBasePerMin: 2,
    spawnPerSatPerMin: 6,
    /** 满意度低于该值,客流骤减(很难赚钱)。 */
    lowSatThreshold: 30,
    lowSatPerMin: 1,
    /** 顾客想买的每件东西,有这么大的概率只从货架上现有的商品里挑(见 CustomerSystem.pickWants)。 */
    stockedBias: 0.6,
    /** 等待不超过该秒数被收银,算"及时收银"。 */
    onTimeWaitSec: 15,
};

export const SATISFACTION = {
    /** 顾客想要的东西没货(每样)。 */
    missingItem: -2,
    /** 单位顾客因缺货最多扣多少。 */
    maxMissPenaltyPerCustomer: -4,
    /** 排队太久,顾客生气离开。 */
    angryLeave: -3,
    /** 队伍太长,顾客直接走。 */
    queueFull: -1,
    /** 打烊时还在排队的顾客被请走。 */
    kickedOut: -2,
    servedOnTime: 1,
    /** 满意度已经低于 CUSTOMER.lowSatThreshold 时,及时收银的回暖加成(口碑跌到谷底后能一点点爬回来)。 */
    servedOnTimeRebound: 2,
    servedLate: 0.3,
};

export const XP = {
    /** 每成功收银一位顾客。 */
    perSale: 4,
    /** 每卖出一件商品。 */
    perSoldUnit: 1,
    /** 每上架一件新到货的商品。 */
    perStockedUnit: 1,
};

/** 前几个游戏日是新手保护期:不触发高惩罚的突发事件(事件系统在步骤 10)。 */
export const BEGINNER_PROTECTION_DAYS = 3;

export function isBeginnerProtected(day: number): boolean {
    return day <= BEGINNER_PROTECTION_DAYS;
}

/** 垃圾:顾客逛店后会留下垃圾,堆多了拉低满意度,玩家走过去清扫。 */
export const TRASH = {
    /** 每成功收银一位顾客,留下垃圾的概率。 */
    chancePerSale: 0.3,
    /** 店里最多同时有多少处垃圾。 */
    max: 12,
    /** 不超过这个数量不影响满意度。 */
    freeCount: 2,
    /** 开门营业时,每多一处垃圾,每秒扣多少满意度。 */
    penaltyPerPiecePerSec: 0.005,
    /** 走到离垃圾多近(米)可以清扫。 */
    sweepRange: 1.2,
};

/**
 * 顾客调研。顾客类型由顾客编号决定(不消耗随机数,不影响其他系统的随机序列):
 * 编号取模得 0~99,小于 surveyPercent 是问卷客,接着 secretPercent 个是暗访客。
 */
export const SURVEY = {
    /** 问卷客占比(%)。第 2 天起才有,第 1 天不打扰新手;新手保护期也会出现(只给奖励,没有惩罚)。 */
    surveyPercent: 12,
    /** 暗访客占比(%)。需要超市达到 secretMinLevel 级且过了新手保护期。 */
    secretPercent: 6,
    secretMinLevel: 2,
    /** 完成问卷的奖励。 */
    rewardCoins: 20,
    rewardSatisfaction: 1,
    rewardXp: 8,
    /** 暗访客结账后,按评分(1~5)调整满意度。 */
    secretDelta: [-2, -1, 0, 1, 2],
    /** 等待多少秒以内算"很快" / "还行",超过算"等太久"。 */
    waitFastSec: 15,
    waitOkSec: 30,
    /** 最多保留多少条反馈记录。 */
    feedbackLimit: 30,
};

/** 突发事件:出现频率、倒计时、处理费用与超时的损失(损失有上限,保证一次事件不会让玩家无法继续)。 */
export const EVENTS = {
    /** 两次事件之间的间隔(秒),每次在范围内随机。 */
    cooldownMin: 80,
    cooldownMax: 160,
    /** 玩家处境艰难时(满意度低于 CUSTOMER.lowSatThreshold,或金币低于它)暂停会造成损失的事件,
     *  和新手保护期一样:没钱处理、又被事件接连扣分,是满意度跌光的主要原因。 */
    shieldBelowCoins: 60,
    /** 同时最多几个待处理事件。 */
    maxActive: 2,
    /** 处理倒计时(秒)。 */
    durationSec: 45,
    /** 妥善处理的奖励。 */
    handledXp: 10,
    handledSatisfaction: 1,
    /** 单次事件最多损失的金币与商品件数。 */
    lossCapCoins: 150,
    lossCapUnits: 12,
    rain: { cleanCost: 30, timeoutPenalty: -4, protectedPenalty: -2 },
    heat: { maintainCost: 60, lossUnits: 6, penalty: -2 },
    wind: { reinforceCost: 60, replaceCost: 150, penalty: -1 },
    blackout: { repairCost: 70, lossUnits: 8, penalty: -3 },
    expiring: { promoFactor: 0.6, lossRatio: 0.5, penalty: -1, minUnits: 3 },
    supplier: { factor: 0.8 },
    /** 火情:灭火器灭火零成本;疏散只保人不保货;不理会则按上限损失金币和商品。 */
    fire: { timeoutCoins: 120, timeoutUnits: 8, penalty: -4, evacuateCoins: 40, evacuateUnits: 3, evacuatePenalty: -1 },
    /** 消防抽查:合格有奖励,不合格(含拒绝检查)罚款。 */
    inspection: { rewardCoins: 60, fine: 80, penalty: -2 },
    /** 价格战:三选一,影响持续到 days 天后(含当天)。 */
    priceWar: { days: 2, followPriceFactor: 0.9, loyalMinSatisfaction: 70, loyalFailTraffic: 0.85, posterCost: 60, posterTraffic: 0.95, timeoutTraffic: 0.75, timeoutPenalty: -1 },
    /** 竞品开业 / 倒闭 / 供货商被抢走。 */
    competitor: { openDays: 3, openTraffic: 0.85, promoCost: 80, promoTraffic: 0.95, closeDays: 2, closeTraffic: 1.2 },
    supplierStolen: { days: 2, costFactor: 1.15, negotiateCost: 100 },
    /** 触发这些新事件所需的最低等级。 */
    fireMinLevel: 2,
    competitionMinLevel: 3,
};

/** 招商:商户入驻档口(每次扩建多一个档口),按天收租;满意度太低或事故太多会解约。 */
export const MERCHANT = {
    /** 解锁条件:超市等级 + 至少扩建 1 次。 */
    unlockLevel: 4,
    minExpansion: 1,
    /** 一份租约的天数;到期不续约商户就走(押金退还)。 */
    termDays: 7,
    /** 续约费用 = 押金 × 该比例。 */
    renewFeeRatio: 0.25,
    /** 一天结束时满意度低于该值,或当天超时没处理的事件不少于 maxIncidents,算"糟糕的一天"。 */
    minSatisfaction: 40,
    maxIncidents: 3,
    /** 连续多少个糟糕的一天,商户解约搬走(第一天先预警)。 */
    badDaysToLeave: 2,
};

/** 员工:按规则自动做事,每天扣工资;发不出工资就离职。玩家仍可亲自做同样的工作。 */
export const STAFF = {
    cashier: { name: '收银员', wage: 40, hireFee: 100, unlockLevel: 4, stepSec: 2.5, desc: '自动给队首顾客扫码、收款' },
    stocker: { name: '理货员', wage: 50, hireFee: 120, unlockLevel: 5, stepSec: 4, desc: '自动把卸货区的箱子放进合适的货架/冷柜,设备收进仓库' },
};

/** 激励广告:全部自愿,每个场景每天有次数上限(跨天重置)。 */
export const ADS = {
    dailyCap: { coins: 5, expedite_order: 5, theme: 3, buff: 2 } as { [placement: string]: number },
    /** 资金紧张时,看广告补金币的次数额外增加。 */
    distressExtraCoinAds: 3,
    /** 限时人气 buff:客流倍率与持续天数(含当天)。 */
    buffTraffic: 1.3,
    buffDays: 1,
};

/** 资金紧张(温和失败):金币很少、没货可卖、没有在途货物,连续几天就进入。不会删档。 */
export const DISTRESS = {
    coinsBelow: 60,
    days: 2,
    /** 卖掉店里的设备,返还原价的比例。 */
    sellRatio: 0.5,
    /** 金币回到这个数就脱离资金紧张。 */
    recoverCoins: 150,
    /** 进入资金紧张时的一次性救济:卸货区白送这么多批最便宜的(店里有容器能摆的)商品,
     *  并且把满意度托到至少这个值(高于低满意度阈值,客流才不会继续卡在谷底)。 */
    reliefBatches: 3,
    reliefSatisfaction: 35,
};

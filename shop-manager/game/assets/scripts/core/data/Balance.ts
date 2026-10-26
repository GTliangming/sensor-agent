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
    lowSatPerMin: 0.5,
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

/** 突发事件:出现频率、倒计时、处理费用与超时的损失(损失有上限,保证一次事件不会让玩家无法继续)。 */
export const EVENTS = {
    /** 两次事件之间的间隔(秒),每次在范围内随机。 */
    cooldownMin: 50,
    cooldownMax: 100,
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
    heat: { maintainCost: 80, lossUnits: 6, penalty: -2 },
    wind: { reinforceCost: 60, replaceCost: 150, penalty: -1 },
    blackout: { repairCost: 100, lossUnits: 8, penalty: -3 },
    expiring: { promoFactor: 0.6, lossRatio: 0.5, penalty: -1, minUnits: 3 },
    supplier: { factor: 0.8 },
};

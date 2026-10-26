// 天气:每个游戏日一种天气,前两天会在电脑里提前预报。天气只通过「客流倍率 / 送货延迟 / 货车停运 / 冷饮热销」影响经营,
// 不直接扣玩家的钱;需要玩家应对的突发事件见 EventSystem。
import type { Rng } from '../base/Rng';
import { isBeginnerProtected } from '../data/Balance';
import type { RGB } from '../data/Catalog';

export type WeatherKind = 'clear' | 'rain' | 'hot' | 'wind' | 'snow_fog';

export interface WeatherInfo {
    name: string;
    /** 客流倍率。 */
    trafficMul: number;
    /** 送货时间倍率(>1 表示延迟)。 */
    deliveryMul: number;
    /** 货车是否停运(订单要等天气过去才能送达)。 */
    trucksStopped: boolean;
    /** 冷饮、雪糕是否热销。 */
    coldBoost: boolean;
    /** 给玩家的备战建议。 */
    tip: string;
}

export const WEATHER: Record<WeatherKind, WeatherInfo> = {
    clear: { name: '晴', trafficMul: 1, deliveryMul: 1, trucksStopped: false, coldBoost: false, tip: '天气不错,正常经营。' },
    rain: {
        name: '暴雨',
        trafficMul: 0.7,
        deliveryMul: 1.5,
        trucksStopped: false,
        coldBoost: false,
        tip: '客流下降、送货变慢,门口会积水。提前在门口摆好防滑垫,或者看广告加急送货。',
    },
    hot: {
        name: '高温',
        trafficMul: 1.25,
        deliveryMul: 1,
        trucksStopped: false,
        coldBoost: true,
        tip: '冷饮和雪糕热销,冷柜容易出故障。提前补足冷饮,备好维修的钱。',
    },
    wind: {
        name: '大风',
        trafficMul: 0.9,
        deliveryMul: 1,
        trucksStopped: false,
        coldBoost: false,
        tip: '门头招牌可能被吹落。花点钱加固,比重新买便宜。',
    },
    snow_fog: {
        name: '暴雪大雾',
        trafficMul: 0.4,
        deliveryMul: 1,
        trucksStopped: true,
        coldBoost: false,
        tip: '客流暴跌、货车停运。趁空闲整理货架、打扫卫生,把满意度拉上去。',
    },
};

/** 按概率抽一种天气。第 1 天固定晴天;新手保护期只会出现晴、雨、高温。 */
export function rollWeather(rng: Rng, day: number): WeatherKind {
    if (day <= 1) return 'clear';
    const r = rng.next();
    if (isBeginnerProtected(day)) return r < 0.6 ? 'clear' : r < 0.85 ? 'rain' : 'hot';
    return r < 0.45 ? 'clear' : r < 0.65 ? 'rain' : r < 0.8 ? 'hot' : r < 0.9 ? 'wind' : 'snow_fog';
}

export function isWeatherKind(v: unknown): v is WeatherKind {
    return typeof v === 'string' && Object.prototype.hasOwnProperty.call(WEATHER, v);
}

/** 天气对画面氛围的影响:光照强度倍率,以及把天空色向某种颜色混合多少(0~1)。 */
export interface WeatherTint {
    intensityMul: number;
    sky: RGB;
    skyAmount: number;
}

export const WEATHER_TINT: Record<WeatherKind, WeatherTint> = {
    clear: { intensityMul: 1, sky: [255, 255, 255], skyAmount: 0 },
    rain: { intensityMul: 0.75, sky: [110, 120, 135], skyAmount: 0.65 },
    hot: { intensityMul: 1.1, sky: [255, 230, 170], skyAmount: 0.25 },
    wind: { intensityMul: 0.95, sky: [160, 170, 180], skyAmount: 0.25 },
    snow_fog: { intensityMul: 0.85, sky: [205, 210, 215], skyAmount: 0.75 },
};

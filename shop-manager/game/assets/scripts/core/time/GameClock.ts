// 游戏时间:1 个游戏日 = 现实 3~5 分钟(默认 4 分钟),分为早上、中午、傍晚、夜间。
// 纯函数,不依赖引擎。时长和时段边界都放在配置里,方便调平衡。

export type DayPhase = 'morning' | 'noon' | 'evening' | 'night';

export interface ClockConfig {
    /** 一个游戏日对应的现实秒数。 */
    dayLengthSec: number;
    /** 一天开始/结束的游戏内小时(结束 24 = 午夜)。 */
    dayStartHour: number;
    dayEndHour: number;
    /** 各时段开始的游戏内小时,需递增。 */
    phaseStartHours: Record<DayPhase, number>;
}

export const DEFAULT_CLOCK_CONFIG: ClockConfig = {
    dayLengthSec: 240,
    dayStartHour: 6,
    dayEndHour: 24,
    phaseStartHours: { morning: 6, noon: 11, evening: 16, night: 19 },
};

/** timeOfDay(0~1)对应的游戏内小时(浮点数,6.5 = 06:30)。 */
export function hourAt(timeOfDay: number, cfg: ClockConfig = DEFAULT_CLOCK_CONFIG): number {
    return cfg.dayStartHour + timeOfDay * (cfg.dayEndHour - cfg.dayStartHour);
}

export function phaseAt(timeOfDay: number, cfg: ClockConfig = DEFAULT_CLOCK_CONFIG): DayPhase {
    const h = hourAt(timeOfDay, cfg);
    const p = cfg.phaseStartHours;
    if (h >= p.night) return 'night';
    if (h >= p.evening) return 'evening';
    if (h >= p.noon) return 'noon';
    return 'morning';
}

/** 格式化为 "HH:MM"。 */
export function formatClock(timeOfDay: number, cfg: ClockConfig = DEFAULT_CLOCK_CONFIG): string {
    const totalMinutes = Math.floor(hourAt(timeOfDay, cfg) * 60);
    const hh = Math.floor(totalMinutes / 60) % 24;
    const mm = totalMinutes % 60;
    // 工程编译目标是 ES2015,没有 String.prototype.padStart,手动补零
    const pad2 = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${pad2(hh)}:${pad2(mm)}`;
}

/** 推进时间。返回新的 timeOfDay(0~1)和跨过的天数。 */
export function advanceTime(
    timeOfDay: number,
    dtSec: number,
    cfg: ClockConfig = DEFAULT_CLOCK_CONFIG,
): { timeOfDay: number; daysPassed: number } {
    const total = timeOfDay + dtSec / cfg.dayLengthSec;
    const daysPassed = Math.floor(total);
    return { timeOfDay: total - daysPassed, daysPassed };
}

/** 一个游戏日包含的游戏内分钟数。 */
export function minutesPerDay(cfg: ClockConfig = DEFAULT_CLOCK_CONFIG): number {
    return (cfg.dayEndHour - cfg.dayStartHour) * 60;
}

/** 从游戏开始累计的游戏内分钟数(浮点数),用于订单送达等跨天计时。 */
export function absoluteMinutes(day: number, timeOfDay: number, cfg: ClockConfig = DEFAULT_CLOCK_CONFIG): number {
    const mpd = minutesPerDay(cfg);
    return (day - 1) * mpd + timeOfDay * mpd;
}

/** 把累计分钟数还原成"第几天 + 钟点",用于显示"预计几点送达"。 */
export function describeAbsoluteMinute(abs: number, cfg: ClockConfig = DEFAULT_CLOCK_CONFIG): { day: number; clock: string } {
    const mpd = minutesPerDay(cfg);
    const day = Math.floor(abs / mpd) + 1;
    const t = (abs - (day - 1) * mpd) / mpd;
    return { day, clock: formatClock(Math.min(Math.max(t, 0), 0.99999), cfg) };
}

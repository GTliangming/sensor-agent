// 昼夜光照曲线:按游戏内小时插值得到光照强度、太阳角度、光色和天空色。纯函数,可单元测试。
// 数值是占位美术参数,调整时只改下面的关键帧表。

export type RGB = [number, number, number];

export interface Lighting {
    /** 相对白天强度的倍数,1 = 正午。 */
    intensity: number;
    /** 平行光俯仰角(度),负值表示朝下照。 */
    sunPitchDeg: number;
    sunColor: RGB;
    /** 天空/背景颜色。不使用天空盒:天空盒贴图会占约 0.8MB 主包,而微信主包上限只有 4MB。 */
    skyColor: RGB;
}

interface Keyframe {
    hour: number;
    intensity: number;
    pitch: number;
    sun: RGB;
    sky: RGB;
}

// 夜间保留 0.3 的最低强度:夜里玩家仍要留在店内整理货架,不能漆黑一片。
const KEYS: Keyframe[] = [
    { hour: 6, intensity: 0.4, pitch: -15, sun: [255, 190, 150], sky: [44, 54, 96] },
    { hour: 8, intensity: 0.9, pitch: -45, sun: [255, 235, 210], sky: [150, 200, 240] },
    { hour: 12, intensity: 1.0, pitch: -85, sun: [255, 250, 240], sky: [160, 205, 240] },
    { hour: 16, intensity: 1.0, pitch: -130, sun: [255, 240, 215], sky: [160, 205, 240] },
    { hour: 18, intensity: 0.7, pitch: -155, sun: [255, 170, 100], sky: [240, 150, 90] },
    { hour: 19.5, intensity: 0.4, pitch: -165, sun: [150, 150, 220], sky: [40, 44, 90] },
    { hour: 21, intensity: 0.3, pitch: -60, sun: [120, 140, 210], sky: [20, 26, 56] },
    { hour: 24, intensity: 0.3, pitch: -60, sun: [120, 140, 210], sky: [20, 26, 56] },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function lightingAt(hour: number): Lighting {
    const h = Math.min(Math.max(hour, KEYS[0].hour), KEYS[KEYS.length - 1].hour);
    let i = 0;
    while (i < KEYS.length - 2 && h > KEYS[i + 1].hour) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const t = (h - a.hour) / (b.hour - a.hour);
    return {
        intensity: lerp(a.intensity, b.intensity, t),
        sunPitchDeg: lerp(a.pitch, b.pitch, t),
        sunColor: lerpRgb(a.sun, b.sun, t),
        skyColor: lerpRgb(a.sky, b.sky, t),
    };
}

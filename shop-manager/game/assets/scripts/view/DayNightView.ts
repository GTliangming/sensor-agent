// 把昼夜光照曲线(core/time/DayCycle)应用到场景:平行光角度/颜色/强度、环境光、背景天空色。
// 记录场景初始的光照值作为"正午基准",之后只按倍数缩放,这样美术在编辑器里调的基准值依然有效。
// 天空一律用纯色背景(不用天空盒),以节省微信 4MB 主包的体积。
import { Camera, Color, DirectionalLight, director } from 'cc';
import { WEATHER_TINT, WeatherKind } from '../core/events/Weather';
import { lightingAt } from '../core/time/DayCycle';

export class DayNightView {
    private readonly baseIlluminance: number;
    private readonly baseSkyIllum: number;
    private readonly sunColor = new Color();
    private readonly skyColor = new Color();
    private lastHour = -1;
    private lastWeather: WeatherKind | null = null;

    constructor(
        private readonly sun: DirectionalLight,
        private readonly camera: Camera,
    ) {
        this.baseIlluminance = sun.illuminance;
        this.baseSkyIllum = director.getScene()!.globals.ambient.skyIllum;
        camera.clearFlags = Camera.ClearFlag.SOLID_COLOR;
    }

    /** 每帧调用,hour 为游戏内小时(浮点数)。变化很小时跳过,省去无谓的属性写入。 */
    apply(hour: number, weather: WeatherKind): void {
        if (Math.abs(hour - this.lastHour) < 0.01 && weather === this.lastWeather) return;
        this.lastHour = hour;
        this.lastWeather = weather;

        const l = lightingAt(hour);
        const tint = WEATHER_TINT[weather];
        l.intensity *= tint.intensityMul;
        for (let i = 0; i < 3; i++) l.skyColor[i] = l.skyColor[i] * (1 - tint.skyAmount) + tint.sky[i] * tint.skyAmount;
        this.sun.node.setRotationFromEuler(l.sunPitchDeg, -35, 0);
        this.sunColor.set(l.sunColor[0], l.sunColor[1], l.sunColor[2], 255);
        this.sun.color = this.sunColor;
        this.sun.illuminance = this.baseIlluminance * l.intensity;
        director.getScene()!.globals.ambient.skyIllum = this.baseSkyIllum * l.intensity;

        this.skyColor.set(l.skyColor[0], l.skyColor[1], l.skyColor[2], 255);
        this.camera.clearColor = this.skyColor;
    }
}

// 第一人称玩家的位置与朝向逻辑。纯 TypeScript,不依赖引擎:
// 输入(摇杆/键盘)由表现层翻译成 MoveInput,这里只负责算出新的位置和朝向。
import type { Rect, SpawnPoint } from '../world/StoreLayout';
import { clampCircleInRect, resolveCircleAgainstRects } from './Collision';

/** 移动意图,两个分量都在 -1..1:moveY > 0 向前,moveX > 0 向右。 */
export interface MoveInput {
    moveX: number;
    moveY: number;
}

export interface PlayerMotionOptions {
    /** 碰撞半径(米)。 */
    radius?: number;
    /** 移动速度(米/秒)。 */
    speed?: number;
    /** 俯仰角上限(度),上下对称。 */
    pitchLimitDeg?: number;
    /** 玩家可活动的整体范围。 */
    bounds: Rect;
    /** 不可穿过的障碍(墙、货架等)。 */
    obstacles: readonly Rect[];
}

/** 单帧最大时间步长,避免卡顿后一步走太远穿墙。 */
const MAX_STEP = 1 / 20;

export class PlayerMotion {
    x: number;
    z: number;
    /** 水平朝向(度):0 = 面朝 -z,正值向左转。 */
    yawDeg: number;
    /** 俯仰角(度):正值抬头。 */
    pitchDeg = 0;

    readonly radius: number;
    readonly speed: number;
    readonly pitchLimitDeg: number;
    private readonly bounds: Rect;
    private readonly obstacles: readonly Rect[];

    constructor(spawn: SpawnPoint, options: PlayerMotionOptions) {
        this.x = spawn.x;
        this.z = spawn.z;
        this.yawDeg = spawn.yawDeg;
        this.radius = options.radius ?? 0.3;
        this.speed = options.speed ?? 2.2;
        this.pitchLimitDeg = options.pitchLimitDeg ?? 80;
        this.bounds = options.bounds;
        this.obstacles = options.obstacles;
    }

    /** 转动视角:deltaYawDeg 正值向左转,deltaPitchDeg 正值抬头(自动限幅)。 */
    turn(deltaYawDeg: number, deltaPitchDeg: number): void {
        this.yawDeg = (((this.yawDeg + deltaYawDeg) % 360) + 360) % 360;
        const p = this.pitchDeg + deltaPitchDeg;
        this.pitchDeg = Math.max(-this.pitchLimitDeg, Math.min(this.pitchLimitDeg, p));
    }

    /** 按输入推进一帧。 */
    step(input: MoveInput, dt: number): void {
        const step = Math.min(Math.max(dt, 0), MAX_STEP);
        let mx = input.moveX;
        let my = input.moveY;
        const len = Math.hypot(mx, my);
        if (len < 1e-6 || step === 0) return;
        if (len > 1) {
            // 斜向移动不能比直行更快
            mx /= len;
            my /= len;
        }

        const yaw = (this.yawDeg * Math.PI) / 180;
        // yaw=0 时前方 (0,-1),右方 (1,0);yaw 增大(左转)时按右手系绕 y 轴旋转
        const fx = -Math.sin(yaw);
        const fz = -Math.cos(yaw);
        const rx = Math.cos(yaw);
        const rz = -Math.sin(yaw);

        let nx = this.x + (fx * my + rx * mx) * this.speed * step;
        let nz = this.z + (fz * my + rz * mx) * this.speed * step;

        const pushed = resolveCircleAgainstRects(nx, nz, this.radius, this.obstacles);
        const clamped = clampCircleInRect(pushed.x, pushed.z, this.radius, this.bounds);
        nx = clamped.x;
        nz = clamped.z;
        this.x = nx;
        this.z = nz;
    }
}

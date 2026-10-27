// 性能档位:开局统计一小段时间的平均帧时间,帧率低于阈值就降到低档(少画几位顾客、缩短远裁剪面)。
// 阈值和低档参数是估计值,需要在真机上测量后调整(见开发计划步骤 16)。

export type QualityLevel = 'high' | 'low';

export const QUALITY = {
    /** 统计多少秒后做一次判断。 */
    sampleSeconds: 5,
    /** 平均帧率低于它就降档。 */
    lowFps: 40,
    /** 低档下同时画出的顾客数量上限、相机远裁剪面。 */
    lowMaxCustomers: 3,
    lowCameraFar: 60,
    highMaxCustomers: 8,
    highCameraFar: 100,
};

export class FrameMonitor {
    private seconds = 0;
    private frames = 0;
    private done = false;

    /** 每帧调用;统计满 sampleSeconds 后返回一次档位,其余时候返回 null。 */
    sample(dt: number): QualityLevel | null {
        if (this.done || !(dt > 0)) return null;
        this.seconds += dt;
        this.frames++;
        if (this.seconds < QUALITY.sampleSeconds) return null;
        this.done = true;
        return this.frames / this.seconds < QUALITY.lowFps ? 'low' : 'high';
    }
}

// 可复现的伪随机数(mulberry32)。状态存放在 holder(即 GameState)里,
// 所以存档/读档后随机序列接着走,测试里给定种子就能得到确定的顾客行为。
export class Rng {
    constructor(private readonly holder: { rngState: number }) {}

    /** 返回 [0, 1) 的伪随机小数。 */
    next(): number {
        const s = (this.holder.rngState + 0x6d2b79f5) | 0;
        this.holder.rngState = s;
        let t = Math.imul(s ^ (s >>> 15), s | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** 返回 [min, max] 之间的整数(含两端)。 */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /** 返回 [min, max) 之间的小数。 */
    range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }
}

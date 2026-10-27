// 激励广告接口:core 和界面只依赖它,不关心背后是真广告还是开发期占位。
// 真实的微信激励视频见 platform/WxAdProvider;所有广告入口都必须经过这个接口,
// 每日次数上限由 GameSession 的 *FromAd 命令统一执行。

/** 广告触发场景。新增场景时在这里加,便于统一做每日次数上限。 */
export type AdPlacement = 'coins' | 'expedite_order' | 'theme' | 'buff';

export interface AdProvider {
    /** 能不能展示广告。false 时界面应隐藏或置灰所有"看广告"入口。 */
    readonly available: boolean;

    /** 展示一次激励广告;用户完整看完才回调 true,中途关闭或失败回调 false。 */
    showRewarded(placement: AdPlacement, onResult: (rewarded: boolean) => void): void;
}

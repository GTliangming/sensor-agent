/**
 * 广告服务接口。第一阶段使用模拟实现，真实 SDK 接入时替换实现，不改玩法代码。
 *
 * 真实 SDK 替换点（微信小游戏）：用 wx.createRewardedVideoAd({ adUnitId }) 实现本接口，
 * 监听 onClose：看完（isEnded）才 resolve(true)，中途关闭 resolve(false)；监听 onError 直接
 * resolve(false)；并用 timeoutMs 做兜底超时。调用方（GameScreen.rescue）已处理 false：
 * 显示“广告加载失败，请重试”，不卡住、不扣救场次数。
 */
export interface AdService {
  /** 展示一次激励视频广告。看完返回 true；失败、超时、中途关闭返回 false。 */
  showRewardedAd(): Promise<boolean>;
}

export class MockAdService implements AdService {
  /**
   * @param durationMs 模拟广告播放时长（默认 1200ms）
   * @param failRate 模拟失败率（默认 0，即恒成功；真实广告会失败，调高它可测试失败分支）
   * @param timeoutMs 超时时间（默认 5000ms）：超过它还没播完按失败处理
   */
  constructor(
    private durationMs = 1200,
    private failRate = 0,
    private timeoutMs = 5000,
  ) {}

  showRewardedAd(): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      setTimeout(() => finish(Math.random() >= this.failRate), this.durationMs);
    });
  }
}

export const adService: AdService = new MockAdService();

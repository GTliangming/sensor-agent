/** 广告服务接口。第一阶段使用模拟实现，真实 SDK 接入时替换实现，不改玩法代码。 */
export interface AdService {
  showRewardedAd(): Promise<boolean>;
}

export class MockAdService implements AdService {
  constructor(private durationMs = 1200, private succeed = true) {}

  showRewardedAd(): Promise<boolean> {
    return new Promise((resolve) => setTimeout(() => resolve(this.succeed), this.durationMs));
  }
}

export const adService: AdService = new MockAdService();

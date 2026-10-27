// 没有可用广告时的实现:在微信正式环境里没有配置广告位 ID 时使用。
// 不展示广告、不发奖励;界面看到 available=false 会隐藏或置灰所有"看广告"入口。
import type { AdPlacement, AdProvider } from '../core/services/AdProvider';

export class NoAdProvider implements AdProvider {
    readonly available = false;

    showRewarded(_placement: AdPlacement, onResult: (rewarded: boolean) => void): void {
        onResult(false);
    }
}

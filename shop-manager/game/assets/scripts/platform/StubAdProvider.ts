// 开发期占位广告:不展示任何广告,直接判定"已看完",方便调试流程。
// 注意:它会无限制地发放奖励,发布前必须换成真实实现(步骤 15)。
import type { AdPlacement, AdProvider } from '../core/services/AdProvider';

export class StubAdProvider implements AdProvider {
    showRewarded(placement: AdPlacement, onResult: (rewarded: boolean) => void): void {
        console.log(`[StubAd] 模拟看完广告:${placement}`);
        onResult(true);
    }
}

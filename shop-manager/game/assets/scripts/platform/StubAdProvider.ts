// 开发期占位广告:不展示任何广告,直接判定"已看完",方便调试流程。
// 只在编辑器预览/浏览器调试里使用(见 platform/AdFactory);微信里没配广告位时用 NoAdProvider,不会发假奖励。
import type { AdPlacement, AdProvider } from '../core/services/AdProvider';

export class StubAdProvider implements AdProvider {
    readonly available = true;

    showRewarded(placement: AdPlacement, onResult: (rewarded: boolean) => void): void {
        console.log(`[StubAd] 模拟看完广告:${placement}`);
        onResult(true);
    }
}

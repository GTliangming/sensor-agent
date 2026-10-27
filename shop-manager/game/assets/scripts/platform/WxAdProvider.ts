// 微信激励视频广告。广告位 ID 需要你在微信公众平台申请,填到 AdConfig.ts 的 AD_UNIT_IDS 里;
// 没填(或不在微信环境里)时 GameBootstrap 会继续使用开发期占位广告。
// 次数上限、发奖励都在 core 里统一处理,这里只负责"展示广告并报告用户是否完整看完"。
import type { AdPlacement, AdProvider } from '../core/services/AdProvider';

declare const wx: any;

export class WxAdProvider implements AdProvider {
    readonly available = true;

    private readonly cache: { [unitId: string]: any } = {};

    constructor(private readonly unitIds: { [placement: string]: string }) {}

    /** 在微信环境里,并且至少配置了一个广告位 ID。 */
    static isUsable(unitIds: { [placement: string]: string }): boolean {
        const hasApi = typeof wx !== 'undefined' && wx !== null && typeof wx.createRewardedVideoAd === 'function';
        return hasApi && Object.keys(unitIds).some((k) => !!unitIds[k]);
    }

    showRewarded(placement: AdPlacement, onResult: (rewarded: boolean) => void): void {
        const unitId = this.unitIds[placement] || this.unitIds['default'];
        if (!unitId) {
            onResult(false); // 这个场景没有配置广告位:不发奖励
            return;
        }
        let ad = this.cache[unitId];
        if (!ad) {
            ad = wx.createRewardedVideoAd({ adUnitId: unitId });
            this.cache[unitId] = ad;
        }

        let finished = false;
        const finish = (rewarded: boolean) => {
            if (finished) return;
            finished = true;
            ad.offClose(onClose);
            ad.offError(onError);
            onResult(rewarded);
        };
        // 只有 isEnded 为 true(完整看完)才发奖励;中途关闭或加载失败都不发
        const onClose = (res: { isEnded?: boolean } | undefined) => finish(!!(res && res.isEnded));
        const onError = () => finish(false);
        ad.onClose(onClose);
        ad.onError(onError);

        ad.show().catch(() => {
            ad.load()
                .then(() => ad.show())
                .catch(() => finish(false));
        });
    }
}

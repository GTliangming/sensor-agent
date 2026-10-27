// 选择广告实现:
// - 配置了广告位 ID 且在微信里:真实激励视频;
// - 在微信里但没配 ID:不提供广告(绝不发"假奖励");
// - 其他环境(编辑器预览、浏览器调试):占位广告,直接判定看完,方便调试。
// 每日次数上限由 core 统一执行,与具体实现无关。
import { sys } from 'cc';
import type { AdProvider } from '../core/services/AdProvider';
import { AD_UNIT_IDS } from './AdConfig';
import { NoAdProvider } from './NoAdProvider';
import { StubAdProvider } from './StubAdProvider';
import { WxAdProvider } from './WxAdProvider';

export function createAdProvider(): AdProvider {
    if (WxAdProvider.isUsable(AD_UNIT_IDS)) return new WxAdProvider(AD_UNIT_IDS);
    if (sys.platform === sys.Platform.WECHAT_GAME) {
        console.warn('[AdFactory] 微信环境里没有配置广告位 ID(platform/AdConfig.ts),本次不提供广告');
        return new NoAdProvider();
    }
    return new StubAdProvider();
}

// 广告位配置。在微信公众平台申请激励视频广告位后,把 ID 填在这里(键是广告场景,'default' 表示所有场景共用)。
// 留空时游戏使用开发期占位广告(不展示广告,直接判定看完;每日次数上限依然生效)。
// 注意:上线前必须填好,否则玩家看到的是"假广告"。
export const AD_UNIT_IDS: { [placement: string]: string } = {
    // default: 'adunit-xxxxxxxxxxxxxxxx',
    // coins: 'adunit-xxxxxxxxxxxxxxxx',
};

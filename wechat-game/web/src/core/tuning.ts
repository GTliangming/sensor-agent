// 遮挡判定调参（集中配置，唯一来源；改了这里要重跑 npm run gen:levels + npm run validate:configs）。
// 实验依据（scripts/occlusion-experiment.ts，2026-11-12 实测）：
//  - 阈值 3 与 5 生成的 10 关几乎一致（被压住 222 vs 224 个，minWrong 合计同为 16）；阈值 3 的关卡里 0 个实例
//    只被盖住 3–4 个掩码点（221 个在 8 点以上）——粗排几何已保证压住就是实打实压住，“擦边点不了”在生成
//    数据里基本不存在。默认取 5，只为留出安全余量，不改变实际玩法。
//  - 阈值 8 不可用：第 3 关在 20000 次尝试内生成失败（分配目标失败 18773 次）。
//  - blockThreshold 是粗排阈值（被上层盖住面积占比超过该值即遮挡），调它会改变物品堆形状，须连同重跑实验。

export interface OcclusionTuning {
  /** 上层图标至少盖住下层图标这么多个掩码采样点，才算遮挡 */
  minOverlapPoints: number;
  /** 粗排时被上层覆盖面积占比超过该值即视为被遮挡 */
  blockThreshold: number;
}

export const OCCLUSION_TUNING: OcclusionTuning = {
  minOverlapPoints: 5,
  blockThreshold: 0.08,
};

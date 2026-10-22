// 统计卡片组件：用一张卡片展示单个指标（数值 + 图标 + 说明），常用于仪表盘。
import { Card, Statistic } from 'antd';
// props 说明：
//   title  -> 指标名称（如"运行次数"）
//   value  -> 指标数值
//   suffix -> 数值后缀（如单位"次"）
//   prefix -> 数值前缀（如货币符号）
//   hint   -> 卡片底部的补充说明文案
//   icon   -> 右上角显示的图标
//   color  -> 主题色，默认紫色；同时作用于图标颜色和其背景
export default function StatCard({ title, value, suffix, prefix, hint, icon, color = '#625bf6' }) {
  return (
    <Card className="stat-card" bordered={false}>
      <div className="stat-card-top">
        <span>{title}</span>
        {/* 图标用 color 作为前景色；background 在 color 后拼接 "14"（十六进制透明度 ≈ 8%），得到同色系的浅色背景 */}
        <span className="stat-icon" style={{ color, background: `${color}14` }}>
          {icon}
        </span>
      </div>
      {/* antd 的 Statistic 专门用于展示统计数值，valueStyle 控制数字的字重、字号和颜色 */}
      <Statistic
        value={value}
        suffix={suffix}
        prefix={prefix}
        valueStyle={{ fontWeight: 700, fontSize: 27, color: '#171a2b' }}
      />
      <div className="stat-hint">{hint}</div>
    </Card>
  );
}

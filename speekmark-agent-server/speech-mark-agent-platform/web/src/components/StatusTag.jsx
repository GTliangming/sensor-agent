// 状态标签组件：根据传入的状态码渲染带颜色的中文标签（如"成功""运行中""失败"）。
import { Tag } from 'antd';
// statusMeta 是状态码到 { 中文文案, 颜色 } 的映射表（类似 Python 的 dict）。
import { statusMeta } from '../utils/format';
// props：status -> 状态码字符串（如 'succeeded'、'failed'）
export default function StatusTag({ status }) {
  // 按状态码查映射表；查不到时兜底：文案用原始状态码，没有则显示"未知"，颜色用默认灰。
  const meta = statusMeta[status] || { label: status || '未知', color: 'default' };
  return (
    <Tag color={meta.color} bordered={false}>
      {meta.label}
    </Tag>
  );
}

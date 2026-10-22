// 空状态面板组件：当列表/区域没有数据时，显示一个占位的"空"提示。
import { Empty } from 'antd';
// props：description -> 空状态下的提示文案，默认"暂无数据"
export default function EmptyPanel({ description = '暂无数据' }) {
  // 使用 antd 内置的简约版空状态插图（PRESENTED_IMAGE_SIMPLE）
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />;
}

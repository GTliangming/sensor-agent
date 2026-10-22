// 页面头部组件：统一展示页面的面包屑、主标题、副标题，以及右侧的操作区域。
import { Breadcrumb, Space, Typography } from 'antd';
// 从 antd 的 Typography 中解构出标题(Title)和文本(Text)两个子组件，方便直接使用。
const { Title, Text } = Typography;
// props 说明（对应 Python 里函数的关键字参数）：
//   title      -> 页面主标题
//   subtitle   -> 副标题（可选）
//   extra      -> 右侧额外内容，一般放操作按钮（可选）
//   breadcrumb -> 面包屑数组，默认空数组；每一项是一段字符串文案
export default function PageHeader({ title, subtitle, extra, breadcrumb = [] }) {
  return (
    <div className="page-header">
      <div>
        {/* 条件渲染：只有面包屑数组非空时才渲染；把字符串数组映射成 antd 需要的 { title } 对象数组 */}
        {breadcrumb.length > 0 && <Breadcrumb items={breadcrumb.map((x) => ({ title: x }))} />}
        <Title level={2}>{title}</Title>
        {/* 条件渲染：有副标题才显示，type="secondary" 让文字呈次要的灰色 */}
        {subtitle && <Text type="secondary">{subtitle}</Text>}
      </div>
      {/* 条件渲染：有额外内容才显示；Space wrap 让多个元素自动排列并在空间不足时换行 */}
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}

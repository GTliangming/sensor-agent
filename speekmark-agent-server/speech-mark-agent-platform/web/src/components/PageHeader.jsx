import { Breadcrumb, Space, Typography } from 'antd';
const { Title, Text } = Typography;
export default function PageHeader({ title, subtitle, extra, breadcrumb = [] }) { return <div className="page-header"><div>{breadcrumb.length > 0 && <Breadcrumb items={breadcrumb.map((x) => ({ title: x }))} />}<Title level={2}>{title}</Title>{subtitle && <Text type="secondary">{subtitle}</Text>}</div>{extra && <Space wrap>{extra}</Space>}</div>; }

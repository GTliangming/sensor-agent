import { Tag } from 'antd';
import { statusMeta } from '../utils/format';
export default function StatusTag({ status }) { const meta = statusMeta[status] || { label: status || '未知', color: 'default' }; return <Tag color={meta.color} bordered={false}>{meta.label}</Tag>; }

import { Card, Empty, Space, Tag } from 'antd';
import { useParams } from 'react-router-dom';

import PageContainer from '@/components/PageContainer';

export default function ReportDetailPage() {
    const { reportId } = useParams<{ reportId: string }>();

    return (
        <PageContainer
            title="报告详情"
            description="报告正文、指标、异常与建议。当前为骨架页面。"
            extra={<Tag color="blue">{reportId}</Tag>}
        >
            <Card>
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Empty description="报告详情接口就绪后展示" />
                </Space>
            </Card>
        </PageContainer>
    );
}

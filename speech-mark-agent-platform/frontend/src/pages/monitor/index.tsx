import { Card, Empty } from 'antd';

import PageContainer from '@/components/PageContainer';

export default function MonitorPage() {
    return (
        <PageContainer
            title="系统监控"
            description="请求量、模型调用、Token、工具成功率与延迟。V0.9 接入。"
        >
            <Card>
                <Empty description="监控指标将在 V0.9 开放" />
            </Card>
        </PageContainer>
    );
}

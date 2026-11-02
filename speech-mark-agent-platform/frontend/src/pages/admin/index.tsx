import { Card, Empty } from 'antd';

import PageContainer from '@/components/PageContainer';

export default function AdminPage() {
    return (
        <PageContainer
            title="Agent 管理"
            description="模型、Prompt、工具列表与工作流配置。V0.4 后逐步开放。"
        >
            <Card>
                <Empty description="管理能力将在 V0.4 后开放" />
            </Card>
        </PageContainer>
    );
}

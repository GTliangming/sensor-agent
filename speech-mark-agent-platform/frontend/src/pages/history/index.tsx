import { Card, Empty } from 'antd';

import PageContainer from '@/components/PageContainer';

export default function HistoryPage() {
    return (
        <PageContainer title="历史记录" description="历史会话、运行记录与检索。">
            <Card>
                <Empty description="历史记录接口就绪后展示" />
            </Card>
        </PageContainer>
    );
}

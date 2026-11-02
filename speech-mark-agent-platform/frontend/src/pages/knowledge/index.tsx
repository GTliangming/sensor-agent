import { Card, Empty } from 'antd';

import PageContainer from '@/components/PageContainer';

export default function KnowledgePage() {
    return (
        <PageContainer
            title="知识库"
            description="标注规范与历史案例。文档上传、切片与检索测试在 V0.6 接入。"
        >
            <Card>
                <Empty description="知识库能力将在 V0.6 开放" />
            </Card>
        </PageContainer>
    );
}

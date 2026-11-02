import { Card, Col, Empty, Row, Statistic } from 'antd';

import PageContainer from '@/components/PageContainer';

export default function AnalyticsPage() {
    return (
        <PageContainer
            title="数据分析"
            description="生产与质量指标。当前为骨架页面，V0.5 接入真实统计接口后展示。"
        >
            <Row gutter={16}>
                <Col xs={24} sm={12} lg={6}>
                    <Card>
                        <Statistic title="进行中任务" value={0} suffix="个" />
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card>
                        <Statistic title="进行中题包" value={0} suffix="个" />
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card>
                        <Statistic title="平均完成率" value={0} precision={1} suffix="%" />
                    </Card>
                </Col>
                <Col xs={24} sm={12} lg={6}>
                    <Card>
                        <Statistic title="待处理积压" value={0} suffix="题" />
                    </Card>
                </Col>
            </Row>
            <Card title="趋势" style={{ marginTop: 16 }}>
                <Empty description="指标接口就绪后展示趋势图" />
            </Card>
        </PageContainer>
    );
}

import { useQuery } from '@tanstack/react-query';
import { Button, Card, Empty, Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import { useNavigate } from 'react-router-dom';

import PageContainer from '@/components/PageContainer';
import { listReports } from '@/services/report';
import type { ReportSummary } from '@/types';
import { formatDateTime } from '@/utils/format';

export default function ReportListPage() {
    const navigate = useNavigate();
    const { data = [], isLoading } = useQuery({
        queryKey: ['reports'],
        queryFn: listReports,
    });

    const columns: TableProps<ReportSummary>['columns'] = [
        { title: '报告标题', dataIndex: 'title', key: 'title' },
        {
            title: '类型',
            dataIndex: 'type',
            key: 'type',
            width: 140,
            render: (value: string) => <Tag>{value}</Tag>,
        },
        { title: '统计周期', dataIndex: 'period', key: 'period', width: 200 },
        {
            title: '生成时间',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 180,
            render: (value: string) => formatDateTime(value),
        },
        {
            title: '操作',
            key: 'action',
            width: 100,
            render: (_, record) => (
                <Button type="link" size="small" onClick={() => navigate(`/reports/${record.id}`)}>
                    查看
                </Button>
            ),
        },
    ];

    return (
        <PageContainer
            title="报告中心"
            description="运营报告列表。报告生成能力在 V0.5 接入。"
            extra={
                <Button type="primary" disabled>
                    生成报告
                </Button>
            }
        >
            <Card>
                {!isLoading && data.length === 0 ? (
                    <Empty description="暂无报告，V0.5 后支持生成" />
                ) : (
                    <Table<ReportSummary>
                        rowKey="id"
                        loading={isLoading}
                        columns={columns}
                        dataSource={data}
                        pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    />
                )}
            </Card>
        </PageContainer>
    );
}

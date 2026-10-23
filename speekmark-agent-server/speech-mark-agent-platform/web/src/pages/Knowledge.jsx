import { useEffect, useState } from 'react';
import { Button, Card, Input, Space, Table, Tag, Typography, message } from 'antd';
import {
  DatabaseOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
import { agentApi } from '../api/agent';
import { formatTime } from '../utils/format';
const { Text, Paragraph } = Typography;
// 知识库页：展示已接入的业务文档列表，并提供一个检索测试台验证召回效果
export default function Knowledge() {
  // items：已接入的知识文档列表；loading：列表加载中标志
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // notice：后端对列表/检索返回的说明文案（如骨架未接入提示），用于空状态展示
  const [notice, setNotice] = useState('');
  // query：检索输入框内容；results：检索结果（null 表示尚未检索过）
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [searchNotice, setSearchNotice] = useState('');
  // 拉取文档列表：先置 loading，请求完成后写入 items 与说明文案，无论成败都关掉 loading
  const load = () => {
    setLoading(true);
    agentApi
      .listKnowledge()
      .then((r) => {
        setItems(r.items || []);
        setNotice(r.message || '');
      })
      .finally(() => setLoading(false));
  };
  // 组件首次挂载时加载一次文档列表（空依赖数组 => 只执行一次，类似初始化）
  useEffect(() => {
    load();
  }, []);
  // 执行知识检索：输入为空时提示并返回，否则调用后端检索接口并保存结果与说明文案
  const search = async () => {
    if (!query.trim()) {
      message.info('请输入检索内容');
      return;
    }
    const r = await agentApi.searchKnowledge(query.trim());
    setResults(r.items || []);
    setSearchNotice(r.message || '');
  };
  // 文档表格的列定义：render 用于自定义某列的显示内容
  const columns = [
    {
      title: '文档名称',
      dataIndex: 'title',
      render: (v, r) => (
        <div className="knowledge-title">
          <div className="knowledge-file-icon">
            <FileSearchOutlined />
          </div>
          <div>
            <b>{v}</b>
            <div>
              <Text type="secondary">{r.description}</Text>
            </div>
          </div>
        </div>
      ),
      width: '46%',
    },
    { title: '分类', dataIndex: 'category', render: (v) => <Tag bordered={false}>{v}</Tag> },
    { title: '文本片段数', dataIndex: 'chunks', width: 100 },
    { title: '更新时间', dataIndex: 'updated_at', width: 140 },
    {
      title: '索引状态',
      dataIndex: 'status',
      render: (v) => (
        <Tag color={v === '已索引' ? 'success' : 'processing'} bordered={false}>
          {v}
        </Tag>
      ),
      width: 110,
    },
  ];
  return (
    <div className="page-wrap">
      <PageHeader
        title="知识库"
        subtitle="管理智能体使用的业务 SOP、质检规则与验收规范，检索结果应保留来源证据。"
        extra={
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
        }
      />
      <Card bordered={false} className="knowledge-search-card">
        <div className="knowledge-search-heading">
          <div className="knowledge-search-icon">
            <DatabaseOutlined />
          </div>
          <div>
            <h3>知识检索测试台</h3>
            <Text type="secondary">
              输入问题，查看知识库检索结果；后续可扩展查看 文本片段、来源页码、相似度与引用。
            </Text>
          </div>
        </div>
        <div className="knowledge-search-form">
          {/* 检索输入框：绑定 query，按回车（onPressEnter）直接触发 search */}
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={search}
            placeholder="例如：什么情况属于切分边界错误？"
            prefix={<SearchOutlined />}
          />
          <Button type="primary" onClick={search}>
            检索知识
          </Button>
        </div>
        {/* 条件渲染：results 不为 null（即检索过）才显示结果区 */}
        {results && (
          <div className="knowledge-results">
            <div className="knowledge-results-head">
              <b>检索结果</b>
              <Text type="secondary">{results.length} 条</Text>
            </div>
            {/* 有结果则逐条展示排名、标题、分类与相似度；否则给出空结果提示 */}
            {results.length ? (
              results.map((r, i) => (
                <div className="knowledge-result" key={r.id}>
                  <div className="knowledge-result-rank">{i + 1}</div>
                  <div>
                    <b>{r.title}</b>
                    <Paragraph type="secondary">{r.description}</Paragraph>
                    <Space>
                      <Tag color="blue">{r.category}</Tag>
                      {/* 有相似度分数时才显示，乘 100 保留整数转成百分比 */}
                      {r.score && <Tag color="purple">相似度 {(r.score * 100).toFixed(0)}%</Tag>}
                    </Space>
                  </div>
                </div>
              ))
            ) : (
              <Text type="secondary">
                {searchNotice || '没有匹配到文档，可尝试缩短或调整关键词。'}
              </Text>
            )}
          </div>
        )}
      </Card>
      <Card bordered={false} className="table-card" title="已接入知识文档">
        <Table
          rowKey="id"
          dataSource={items}
          columns={columns}
          loading={loading}
          pagination={false}
          locale={{ emptyText: notice || '暂无数据' }}
        />
      </Card>
    </div>
  );
}

import { PlusOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { App, Avatar, Button, Empty, Input, List, Space, Spin, Tag } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { createRun, createThread, listMessages, listThreads } from '@/services/agent';
import type { AgentTrace, ChatMessage } from '@/types';
import { formatDateTime, formatDuration } from '@/utils/format';

const { TextArea } = Input;

export default function ChatPage() {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const { threadId } = useParams<{ threadId?: string }>();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);

    const { data: threads = [], isLoading: threadsLoading, refetch } = useQuery({
        queryKey: ['threads'],
        queryFn: listThreads,
    });

    const activeThreadId = threadId ?? threads[0]?.id;
    const activeThread = threads.find(item => item.id === activeThreadId);

    const createThreadMutation = useMutation({
        mutationFn: () => createThread('新会话'),
        onSuccess: async thread => {
            await refetch();
            setMessages([]);
            navigate(`/chat/${thread.id}`);
        },
        onError: error => {
            message.error(error instanceof Error ? error.message : '创建会话失败');
        },
    });

    const lastTrace = useMemo<AgentTrace | undefined>(() => {
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            if (messages[index].trace) {
                return messages[index].trace;
            }
        }
        return undefined;
    }, [messages]);

    const handleSend = async () => {
        const text = input.trim();
        if (!text || !activeThreadId || sending) {
            return;
        }

        setMessages(prev => [
            ...prev,
            {
                id: `local_${Date.now()}`,
                role: 'user',
                content: text,
                createdAt: new Date().toISOString(),
            },
        ]);
        setInput('');
        setSending(true);

        try {
            const run = await createRun(activeThreadId, text);
            setMessages(prev => [
                ...prev,
                {
                    id: run.id,
                    role: 'assistant',
                    content: run.answer ?? '（本次执行没有返回内容）',
                    createdAt: run.createdAt,
                    trace: run.trace,
                },
            ]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : '执行失败');
            setMessages(prev => [
                ...prev,
                {
                    id: `error_${Date.now()}`,
                    role: 'assistant',
                    content: '执行失败，请稍后重试或检查后端服务。',
                    createdAt: new Date().toISOString(),
                },
            ]);
        } finally {
            setSending(false);
        }
    };

    useEffect(() => {
        if (!activeThreadId) {
            return;
        }

        let cancelled = false;
        setLoadingMessages(true);

        listMessages(activeThreadId)
            .then(rows => {
                if (!cancelled) {
                    setMessages(rows);
                }
            })
            .catch(error => {
                if (!cancelled) {
                    message.error(error instanceof Error ? error.message : '加载消息失败');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoadingMessages(false);
                }
            });

        return () => {
            cancelled = true;
        };
        }, [activeThreadId, message]
    );

    return (
        <div className="chat-page">
            <aside className="chat-panel">
                <div className="chat-panel__header">
                    <span className="chat-panel__title">会话</span>
                    <Button
                        size="small"
                        icon={<PlusOutlined />}
                        loading={createThreadMutation.isPending}
                        onClick={() => createThreadMutation.mutate()}
                    >
                        新建
                    </Button>
                </div>
                <div className="chat-panel__body">
                    {threadsLoading ? (
                        <div className="page-loading">
                            <Spin />
                        </div>
                    ) : (
                        <List
                            dataSource={threads}
                            locale={{ emptyText: '暂无会话' }}
                            renderItem={item => (
                                <List.Item
                                    style={{
                                        cursor: 'pointer',
                                        padding: '10px 12px',
                                        borderRadius: 6,
                                        background:
                                            item.id === activeThreadId ? '#eef3ff' : 'transparent',
                                    }}
                                    onClick={() => {
                                        navigate(`/chat/${item.id}`);
                                    }}
                                >
                                    <List.Item.Meta
                                        title={<span style={{ fontSize: 13 }}>{item.title}</span>}
                                        description={
                                            <span style={{ fontSize: 12 }}>
                                                {formatDateTime(item.updatedAt)}
                                            </span>
                                        }
                                    />
                                </List.Item>
                            )}
                        />
                    )}
                </div>
            </aside>

            <main className="chat-main">
                <div className="chat-main__body">
                    {
                        loadingMessages ? (
                        <div className="page-loading">
                            <Spin />
                        </div>
                    ) :
                        messages.length === 0 ? (
                        <div className="chat-main__empty">
                            <Empty
                                description={
                                    activeThreadId
                                        ? '输入一个业务问题开始分析'
                                        : '请先新建一个会话'
                                }
                            />
                        </div>
                    ) : (
                        messages.map(item => (
                            <div
                                key={item.id}
                                className={`chat-message ${
                                    item.role === 'user' ? 'chat-message--user' : ''
                                }`}
                            >
                                <Avatar
                                    size={32}
                                    style={{
                                        background: item.role === 'user' ? '#2f6bff' : '#1f2329',
                                        flex: '0 0 auto',
                                    }}
                                >
                                    {item.role === 'user' ? '我' : 'A'}
                                </Avatar>
                                <div className="chat-message__bubble">{item.content}</div>
                            </div>
                        ))
                    )}
                    {sending ? (
                        <div className="chat-message">
                            <Avatar size={32} style={{ background: '#1f2329', flex: '0 0 auto' }}>
                                A
                            </Avatar>
                            <div className="chat-message__bubble">
                                <Spin size="small" /> 正在分析…
                            </div>
                        </div>
                    ) : null}
                </div>

                <div className="chat-composer">
                    <TextArea
                        value={input}
                        onChange={event => setInput(event.target.value)}
                        placeholder={
                            activeThreadId
                                ? '例如：检查项目 A 昨天的生产情况，找出异常题包并分析原因'
                                : '请先新建会话'
                        }
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        disabled={!activeThreadId || sending}
                        onPressEnter={event => {
                            if (!event.shiftKey) {
                                event.preventDefault();
                                void handleSend();
                            }
                        }}
                    />
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginTop: 10,
                        }}
                    >
                        <span style={{ color: '#8a9099', fontSize: 12 }}>
                            {activeThread ? `当前会话：${activeThread.title}` : '未选择会话'}
                        </span>
                        <Space>
                            <Tag color="blue">只读模式</Tag>
                            <Button
                                type="primary"
                                icon={<SendOutlined />}
                                loading={sending}
                                disabled={!activeThreadId || !input.trim()}
                                onClick={() => void handleSend()}
                            >
                                发送
                            </Button>
                        </Space>
                    </div>
                </div>
            </main>

            <aside className="chat-panel chat-panel--trace">
                <div className="chat-panel__header">
                    <span className="chat-panel__title">执行过程</span>
                </div>
                <div className="chat-panel__body">
                    {!lastTrace ? (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="执行后展示节点与工具调用"
                        />
                    ) : (
                        <>
                            <div className="chat-trace-item">
                                <div className="chat-trace-item__name">节点</div>
                                <div className="chat-trace-item__meta">
                                    {lastTrace.nodes.length} 个
                                </div>
                            </div>
                            {lastTrace.nodes.map(node => (
                                <div key={node.id} className="chat-trace-item">
                                    <div className="chat-trace-item__name">{node.name}</div>
                                    <div className="chat-trace-item__meta">
                                        <Tag
                                            color={node.status === 'success' ? 'green' : 'default'}
                                            style={{ marginInlineEnd: 8 }}
                                        >
                                            {node.status}
                                        </Tag>
                                        {formatDateTime(node.finishedAt ?? node.startedAt)}
                                    </div>
                                </div>
                            ))}
                            <div className="chat-trace-item">
                                <div className="chat-trace-item__name">工具调用</div>
                                <div className="chat-trace-item__meta">
                                    {lastTrace.toolCalls.length} 次
                                </div>
                            </div>
                            {lastTrace.toolCalls.map(call => (
                                <div key={call.id} className="chat-trace-item">
                                    <div className="chat-trace-item__name">{call.name}</div>
                                    <div className="chat-trace-item__meta">
                                        <Tag
                                            color={call.status === 'success' ? 'green' : 'default'}
                                            style={{ marginInlineEnd: 8 }}
                                        >
                                            {call.status}
                                        </Tag>
                                        {formatDuration(call.latencyMs)}
                                    </div>
                                    {call.argsSummary ? (
                                        <div className="chat-trace-item__meta">
                                            {call.argsSummary}
                                        </div>
                                    ) : null}
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </aside>
        </div>
    );
}

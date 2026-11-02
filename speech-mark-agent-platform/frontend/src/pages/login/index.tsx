import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { App, Button, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { login } from '@/services/auth';
import { useAuthStore } from '@/stores/auth';
import type { LoginPayload } from '@/types';

export default function LoginPage() {
    const [loading, setLoading] = useState(false);
    const { message } = App.useApp();
    const navigate = useNavigate();
    const location = useLocation();
    const setAuth = useAuthStore(state => state.setAuth);

    const from = (location.state as { from?: string } | null)?.from ?? '/chat';
    const useMock = import.meta.env.VITE_USE_MOCK === 'true';

    const handleFinish = async (values: LoginPayload) => {
        setLoading(true);
        try {
            const result = await login(values);
            setAuth(result.token, result.user);
            navigate(from, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : '登录失败');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <section className="login-brand">
                <Typography.Title level={2} className="login-brand__title" style={{ color: '#fff' }}>
                    Annotation Ops Agent
                </Typography.Title>
                <p className="login-brand__desc">
                    面向语音标注业务的智能运营分析平台。用自然语言查询真实生产数据，完成统计分析、异常诊断和运营报告，
                    每条结论都可以追溯到数据来源与规范依据。
                </p>
                <ul className="login-brand__points">
                    <li>只读接入现有标注平台，不修改任何业务数据</li>
                    <li>统计由程序计算，模型负责理解与解释</li>
                    <li>结论区分事实、规范依据、原因假设与缺失信息</li>
                </ul>
            </section>

            <section className="login-panel">
                <div className="login-panel__inner">
                    <h2 className="login-panel__title">登录</h2>
                    <p className="login-panel__desc">使用 Agent 平台账号登录</p>

                    <Form<LoginPayload>
                        layout="vertical"
                        requiredMark={false}
                        onFinish={handleFinish}
                        initialValues={{ username: '', password: '' }}
                    >
                        <Form.Item
                            label="用户名"
                            name="username"
                            rules={[{ required: true, message: '请输入用户名' }]}
                        >
                            <Input
                                size="large"
                                prefix={<UserOutlined />}
                                placeholder="请输入用户名"
                                autoComplete="username"
                            />
                        </Form.Item>
                        <Form.Item
                            label="密码"
                            name="password"
                            rules={[{ required: true, message: '请输入密码' }]}
                        >
                            <Input.Password
                                size="large"
                                prefix={<LockOutlined />}
                                placeholder="请输入密码"
                                autoComplete="current-password"
                            />
                        </Form.Item>
                        <Form.Item style={{ marginBottom: 0 }}>
                            <Button type="primary" size="large" htmlType="submit" block loading={loading}>
                                登录
                            </Button>
                        </Form.Item>
                    </Form>

                    {useMock ? (
                        <p className="login-panel__hint">
                            当前为开发模式（Mock），任意非空用户名和密码均可登录。后端就绪后把
                            {' '}
                            <code>VITE_USE_MOCK</code>
                            {' '}
                            改为
                            {' '}
                            <code>false</code>
                            {' '}
                            即可切换真实登录。
                        </p>
                    ) : null}
                </div>
            </section>
        </div>
    );
}

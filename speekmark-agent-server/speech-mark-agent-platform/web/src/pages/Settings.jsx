import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  ExperimentOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import PageHeader from '../components/PageHeader';
// 从 Typography 里解构出文本组件，类似 Python 的 from ... import Text, Paragraph
const { Text, Paragraph } = Typography;
// 系统配置页：仅展示/复制前端开发期的建议配置，不会真正写入环境变量或后端
export default function Settings() {
  // useState 相当于“带 setter 的局部可变状态”，组件重渲染时值会保留
  // base：接口基础地址，默认取构建环境变量 VITE_API_BASE_URL，没有则用 '/api'
  const [base, setBase] = useState(import.meta.env.VITE_API_BASE_URL || '/api');
  // mock：是否使用本地模拟数据；环境变量是字符串，这里转成布尔值（'true' 才算开启）
  const [mock, setMock] = useState(String(import.meta.env.VITE_USE_MOCK ?? 'true') === 'true');
  // timeout：请求超时时间（毫秒），用字符串存储以便和下拉选项的 value 对应
  const [timeout, setTimeoutValue] = useState('20000');
  // 把传入文本写入系统剪贴板，成功后弹出提示（?. 为可选链，剪贴板不可用时不报错）
  const copy = (s) => navigator.clipboard?.writeText(s).then(() => message.success('已复制'));
  return (
    <div className="page-wrap">
      <PageHeader
        title="系统配置"
        subtitle="前端开发期配置说明。生产环境的模型密钥、业务凭证和权限策略必须保存在服务端。"
      />
      <Alert
        className="dev-alert"
        type="warning"
        showIcon
        message="此页面展示的是当前运行配置，不会直接修改构建环境变量"
        description="修改 .env 文件后需要重启 Vite 开发服务器。这里的控件用于查看和复制建议配置，避免产生无法持久化的假设置。"
      />
      <Card
        bordered={false}
        className="settings-card"
        title={
          <span>
            <ApiOutlined /> 接口连接配置
          </span>
        }
      >
        {/* 接口基础地址：输入框与 base 状态双向绑定，onChange 里把最新输入写回状态 */}
        <div className="setting-field">
          <div>
            <b>接口基础地址</b>
            <Text type="secondary">前端接口请求的统一前缀</Text>
          </div>
          <Input value={base} onChange={(e) => setBase(e.target.value)} style={{ maxWidth: 360 }} />
        </div>
        <div className="setting-field">
          <div>
            <b>模拟数据模式</b>
            <Text type="secondary">打开时使用本地模拟数据，不会请求后端</Text>
          </div>
          {/* 开关控件：checked 绑定 mock，切换时直接把新值交给 setMock */}
          <Switch
            checked={mock}
            onChange={setMock}
            checkedChildren="开启"
            unCheckedChildren="关闭"
          />
        </div>
        <div className="setting-field">
          <div>
            <b>请求超时（毫秒）</b>
            <Text type="secondary">需同步修改 src/api/client.js</Text>
          </div>
          <Select
            value={timeout}
            onChange={setTimeoutValue}
            style={{ width: 180 }}
            options={[
              { value: '10000', label: '10 秒' },
              { value: '20000', label: '20 秒' },
              { value: '60000', label: '60 秒' },
            ]}
          />
        </div>
        <Divider />
        <Space>
          {/* 把当前配置拼成 .env 文件文本并复制，方便粘贴到本地 .env */}
          <Button
            type="primary"
            icon={<CopyOutlined />}
            onClick={() =>
              copy(
                `VITE_API_BASE_URL=${base}\nVITE_USE_MOCK=${mock}\nVITE_APP_NAME=语音标注 智能体工作台`
              )
            }
          >
            复制 .env 配置
          </Button>
          <Button onClick={() => copy(`timeout: ${timeout}`)}>复制超时设置</Button>
        </Space>
      </Card>
      <Card
        bordered={false}
        className="settings-card"
        title={
          <span>
            <ExperimentOutlined /> 当前开发状态
          </span>
        }
      >
        <Descriptions
          column={1}
          items={[
            { key: 'frontend', label: '前端框架', children: 'React + Vite + JavaScript' },
            { key: 'ui', label: '组件库', children: 'Ant Design 5' },
            { key: 'charts', label: '图表', children: '@ant-design/plots' },
            { key: 'routing', label: '路由', children: 'React Router' },
            {
              key: 'api',
              label: '当前接口模式',
              // 根据 mock 状态显示不同颜色与文案的标签
              children: (
                <Tag color={mock ? 'processing' : 'success'}>
                  {mock ? '模拟数据适配器' : '真实接口'}
                </Tag>
              ),
            },
            { key: 'auth', label: '认证', children: '待接入 Go 后端会话 / 令牌 方案' },
            { key: 'stream', label: '实时事件', children: '当前轮询方案；后续可升级 SSE' },
          ]}
        />
      </Card>
      <Card
        bordered={false}
        className="settings-card"
        title={
          <span>
            <SafetyCertificateOutlined /> 后端对接检查清单
          </span>
        }
      >
        <div className="settings-checks">
          {/* 把检查清单数组逐项渲染成带勾选图标的一行，key 用文本本身保证唯一 */}
          {[
            '统一响应体与错误码已确认',
            'Go API 对用户身份和数据权限进行服务端校验',
            '运行任务和执行轨迹 使用同一个 run_id 关联',
            '工具调用记录不包含密钥、完整敏感数据或隐藏思维链',
            '审批接口实现权限校验、幂等和状态机校验',
            '真实接口模式下已验证超时、断网、空结果和服务端错误',
          ].map((x) => (
            <div key={x}>
              <CheckCircleOutlined />
              {x}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

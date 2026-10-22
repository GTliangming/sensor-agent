import axios from 'axios';
import { message } from 'antd';

// 创建 axios 实例:统一配置请求基础地址、超时时间和默认请求头。
// baseURL 优先读环境变量 VITE_API_BASE_URL,未配置时默认用 '/api'
// (由 Vite/Nginx 代理转发到 Go 后端的 /api/v1)。
const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 20000, // 请求超时时间(毫秒):超过 20 秒未响应即判为失败
  headers: { 'Content-Type': 'application/json' },
});

// 请求拦截器:每个请求发出前统一处理。
client.interceptors.request.use((config) => {
  // 真实的登录鉴权应由 Go 网关/会话策略注入;前端代码里绝不要存放生产密钥。
  config.headers['X-Request-Source'] = 'agent-hub-web';
  return config;
});

// 响应拦截器:统一处理成功响应与错误响应。
client.interceptors.response.use(
  (response) => {
    // Go API 的成功响应统一为 { data, request_id } 结构。
    // 这里提前把业务数据 data 解包出来,页面就能直接拿到业务内容,无需层层 .data。
    const body = response.data;
    return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
  },
  (error) => {
    // 错误响应统一处理:优先取后端返回的错误信息,取不到再按情况给默认提示。
    const payload = error?.response?.data;
    const text =
      payload?.error?.message ||
      payload?.message ||
      (error.code === 'ECONNABORTED' ? '请求超时，请稍后重试' : '服务暂时不可用，请检查后端服务');
    // 默认弹出全局错误提示;若某个请求不想弹提示,可在请求配置里设置 showGlobalError: false。
    if (error.config?.showGlobalError !== false) message.error(text);
    // 继续向上抛出错误,并附带友好信息和错误码,方便调用方按需处理。
    return Promise.reject(
      Object.assign(error, {
        userMessage: text,
        errorCode: payload?.error?.code || 'REQUEST_FAILED',
      })
    );
  }
);

export default client;

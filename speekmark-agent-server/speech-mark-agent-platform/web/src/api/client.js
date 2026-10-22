import axios from 'axios';
import { message } from 'antd';

const client = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 20000, headers: { 'Content-Type': 'application/json' } });
client.interceptors.request.use((config) => {
  // Real auth should be attached by your Go gateway/session strategy. Never store production secrets in frontend code.
  config.headers['X-Request-Source'] = 'agent-hub-web';
  return config;
});
client.interceptors.response.use((response) => {
  // Go API uses { data, request_id }; unwrap once so pages consume the business payload directly.
  const body = response.data;
  return body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body;
}, (error) => {
  const payload = error?.response?.data;
  const text = payload?.error?.message || payload?.message || (error.code === 'ECONNABORTED' ? '请求超时，请稍后重试' : '服务暂时不可用，请检查后端服务');
  if (error.config?.showGlobalError !== false) message.error(text);
  return Promise.reject(Object.assign(error, { userMessage: text, errorCode: payload?.error?.code || 'REQUEST_FAILED' }));
});
export default client;

// 通用格式化工具：集中放置时间、时长的显示格式化函数，以及状态文案/颜色映射表。
import dayjs from 'dayjs'; // dayjs 是轻量的日期处理库，类似 Python 的 datetime/arrow
// 格式化时间：传入时间值则格式化为 '年-月-日 时:分:秒'；为空时返回占位符 '—'
export const formatTime = (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—');
// 格式化时长：入参为毫秒数
export const formatDuration = (ms) => {
  if (ms == null) return '—'; // 没有值（null/undefined）返回占位符
  if (ms < 1000) return `${ms} ms`; // 不足 1 秒按毫秒显示
  return `${(ms / 1000).toFixed(1)} s`; // 否则换算成秒，保留 1 位小数
};
// 运行/审批状态的元信息映射表：key 为状态码，value 含中文文案 label 与 Ant Design 标签颜色 color
export const statusMeta = {
  succeeded: { label: '成功', color: 'success' },
  running: { label: '运行中', color: 'processing' },
  queued: { label: '排队中', color: 'default' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'default' },
  waiting_approval: { label: '待审批', color: 'warning' },
  pending: { label: '待审批', color: 'warning' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已拒绝', color: 'error' },
};

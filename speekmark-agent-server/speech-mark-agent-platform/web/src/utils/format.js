import dayjs from 'dayjs';
export const formatTime = (value) => value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '—';
export const formatDuration = (ms) => { if (ms == null) return '—'; if (ms < 1000) return `${ms} ms`; return `${(ms / 1000).toFixed(1)} s`; };
export const statusMeta = { succeeded: { label: '成功', color: 'success' }, running: { label: '运行中', color: 'processing' }, queued: { label: '排队中', color: 'default' }, failed: { label: '失败', color: 'error' }, cancelled: { label: '已取消', color: 'default' }, waiting_approval: { label: '待审批', color: 'warning' }, pending: { label: '待审批', color: 'warning' }, approved: { label: '已通过', color: 'success' }, rejected: { label: '已拒绝', color: 'error' } };

import dayjs from 'dayjs';

export function formatDateTime(value?: string | null): string {
    if (!value) {
        return '-';
    }
    const date = dayjs(value);
    return date.isValid() ? date.format('YYYY-MM-DD HH:mm:ss') : '-';
}

export function formatDuration(ms?: number | null): string {
    if (ms === null || ms === undefined) {
        return '-';
    }
    if (ms < 1000) {
        return `${ms} ms`;
    }
    return `${(ms / 1000).toFixed(2)} s`;
}

export function truncate(value: string, max = 60): string {
    return value.length > max ? `${value.slice(0, max)}…` : value;
}

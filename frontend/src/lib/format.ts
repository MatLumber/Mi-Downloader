export function formatBytes(bytes: number | null | undefined): string {
    if (!bytes || bytes <= 0) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function formatDuration(seconds: number | null | undefined): string {
    if (!seconds || seconds <= 0) return '—:—';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatRelativeTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'ahora';
    if (minutes < 60) return `hace ${minutes} min`;
    if (hours < 24) return `hace ${hours} h`;
    if (days < 7) return `hace ${days} d`;
    return d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: days > 365 ? 'numeric' : undefined });
}

export function formatExactTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString('es', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function getFileName(path: string): string {
    if (!path) return '';
    const parts = path.split(/[\\/]/);
    return parts[parts.length - 1] || '';
}

export function getDirName(path: string): string {
    if (!path) return '';
    const parts = path.split(/[\\/]/);
    parts.pop();
    return parts.join('\\') || '';
}

export function shortenPath(path: string, maxSegments = 3): string {
    if (!path) return '';
    const parts = path.split(/[\\/]/).filter(Boolean);
    if (parts.length <= maxSegments) return path;
    return `…/${parts.slice(-maxSegments).join('/')}`;
}

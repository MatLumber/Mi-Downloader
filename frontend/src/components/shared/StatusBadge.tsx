import { CheckCircle2, AlertTriangle, Loader2, Download as DownloadIcon, Clock, X, Activity } from 'lucide-react';
import type { DownloadStatus } from '../../store/useAppStore';

const STATUS_MAP: Record<string, { label: string; cls: string; icon: typeof Clock; pulse?: boolean; spin?: boolean }> = {
    queued: { label: 'En cola', cls: 'badge-queued', icon: Clock },
    fetching_info: { label: 'Analizando', cls: 'badge-fetching', icon: Loader2, spin: true },
    downloading: { label: 'Descargando', cls: 'badge-downloading', icon: DownloadIcon, pulse: true },
    processing: { label: 'Procesando', cls: 'badge-processing', icon: Activity, pulse: true },
    completed: { label: 'Listo', cls: 'badge-completed', icon: CheckCircle2 },
    error: { label: 'Error', cls: 'badge-error', icon: AlertTriangle },
    cancelled: { label: 'Cancelado', cls: 'badge-cancelled', icon: X },
    pending: { label: 'Pendiente', cls: 'badge-queued', icon: Clock },
    starting: { label: 'Iniciando', cls: 'badge-fetching', icon: Loader2, spin: true },
    compressing: { label: 'Comprimiendo', cls: 'badge-processing', icon: Activity, pulse: true },
};

export function StatusBadge({ status, dot = false }: { status: DownloadStatus | string; dot?: boolean }) {
    const config = STATUS_MAP[status] || STATUS_MAP.queued;
    const Icon = config.icon;

    return (
        <span className={`badge ${config.cls}`}>
            {dot ? (
                <span className={`badge-dot ${config.pulse ? 'is-pulse' : ''}`} />
            ) : (
                <Icon size={10} className={config.spin ? 'animate-spin' : ''} strokeWidth={2.4} />
            )}
            {config.label}
        </span>
    );
}

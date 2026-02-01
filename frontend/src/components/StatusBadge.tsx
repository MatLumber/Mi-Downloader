import { motion } from 'framer-motion';
import { Check, AlertTriangle, Loader2, Download, Clock, X } from 'lucide-react';
import type { DownloadStatus } from '../store/useAppStore';

interface StatusBadgeProps {
    status: DownloadStatus;
    size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<DownloadStatus, {
    label: string;
    bgClass: string;
    textClass: string;
    icon: React.ElementType;
    animate?: boolean;
}> = {
    queued: {
        label: 'QUEUED',
        bgClass: 'bg-indigo-900/50 border border-indigo-500/30',
        textClass: 'text-indigo-300',
        icon: Clock,
    },
    fetching_info: {
        label: 'ANALYZING',
        bgClass: 'bg-blue-500/20 border border-blue-400/40',
        textClass: 'text-blue-300',
        icon: Loader2,
        animate: true,
    },
    downloading: {
        label: 'DOWNLOADING',
        bgClass: 'bg-amber-500 shadow-lg shadow-amber-500/30',
        textClass: 'text-black font-bold',
        icon: Download,
        animate: true,
    },
    processing: {
        label: 'PROCESSING',
        bgClass: 'bg-sky-500 shadow-lg shadow-sky-500/30',
        textClass: 'text-black font-bold',
        icon: Loader2,
        animate: true,
    },
    completed: {
        label: 'COMPLETED',
        bgClass: 'bg-emerald-400 shadow-lg shadow-emerald-400/40',
        textClass: 'text-black font-bold',
        icon: Check,
    },
    error: {
        label: 'ERROR',
        bgClass: 'bg-red-500 shadow-lg shadow-red-500/30',
        textClass: 'text-white font-bold',
        icon: AlertTriangle,
    },
    cancelled: {
        label: 'CANCELLED',
        bgClass: 'bg-gray-600',
        textClass: 'text-gray-300',
        icon: X,
    },
};

export function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
    const config = statusConfig[status];
    const Icon = config.icon;

    const sizeClasses = {
        sm: 'px-2 py-0.5 text-[10px] gap-1',
        md: 'px-3 py-1 text-xs gap-1.5',
        lg: 'px-4 py-1.5 text-sm gap-2',
    };

    const iconSizes = {
        sm: 10,
        md: 12,
        lg: 14,
    };

    return (
        <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`
                inline-flex items-center rounded-md
                ${config.bgClass}
                ${config.textClass}
                ${sizeClasses[size]}
            `}
            style={{ fontFamily: 'var(--font-mono)' }}
        >
            <Icon
                size={iconSizes[size]}
                className={config.animate ? 'animate-spin' : ''}
                style={config.animate && status === 'downloading' ? { animation: 'none' } : {}}
            />
            <span className="tracking-wider">{config.label}</span>
        </motion.div>
    );
}

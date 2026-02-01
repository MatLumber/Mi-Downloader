import { motion } from 'framer-motion';
import {
    Folder,
    Play,
    X,
    FileVideo,
    FileAudio,
} from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import type { DownloadTask } from '../store/useAppStore';

interface DownloadCardProps {
    task: DownloadTask;
    onCancel?: () => void;
    onOpenFile?: () => void;
    onOpenFolder?: () => void;
}

export function DownloadCard({ task, onCancel, onOpenFile, onOpenFolder }: DownloadCardProps) {
    const isActive = ['downloading', 'processing', 'fetching_info'].includes(task.status);
    const isCompleted = task.status === 'completed';
    const hasError = task.status === 'error';

    const FormatIcon = task.format_type === 'video' ? FileVideo : FileAudio;

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className={`
                download-card relative p-4 rounded-lg border
                ${hasError
                    ? 'border-red-500/30 bg-red-950/20'
                    : isActive
                        ? 'border-amber-500/30 bg-amber-950/10'
                        : isCompleted
                            ? 'border-emerald-500/20 bg-emerald-950/10'
                            : 'border-gray-700/50 bg-gray-900/30'
                }
                transition-colors duration-200
            `}
        >
            {/* Top Row: Thumbnail + Info */}
            <div className="flex gap-3">
                {/* Thumbnail */}
                <div className="relative w-20 h-14 rounded overflow-hidden flex-shrink-0 bg-gray-800">
                    {task.thumbnail ? (
                        <img
                            src={task.thumbnail}
                            alt=""
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center">
                            <FormatIcon className="w-6 h-6 text-gray-600" />
                        </div>
                    )}
                    {/* Format Badge */}
                    <div className="absolute bottom-1 right-1 px-1.5 py-0.5 bg-black/70 rounded text-[9px] text-gray-300 uppercase"
                        style={{ fontFamily: 'var(--font-mono)' }}>
                        {task.quality}
                    </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-gray-200 truncate mb-1">
                        {task.title || 'Loading...'}
                    </h4>
                    <div className="flex items-center gap-2">
                        <StatusBadge status={task.status} size="sm" />
                        {task.filesize && (
                            <span className="text-[10px] text-gray-500" style={{ fontFamily: 'var(--font-mono)' }}>
                                {formatFileSize(task.filesize)}
                            </span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-start gap-1">
                    {isCompleted && (
                        <>
                            <ActionButton
                                icon={Play}
                                tooltip="Open File"
                                onClick={onOpenFile}
                                variant="success"
                            />
                            <ActionButton
                                icon={Folder}
                                tooltip="Open Folder"
                                onClick={onOpenFolder}
                            />
                        </>
                    )}
                    {isActive && (
                        <ActionButton
                            icon={X}
                            tooltip="Cancel"
                            onClick={onCancel}
                            variant="danger"
                        />
                    )}
                </div>
            </div>

            {/* Progress Bar (only when downloading) */}
            {task.status === 'downloading' && (
                <div className="mt-3">
                    <div className="flex items-center justify-between mb-1.5">
                        <span
                            className="text-lg font-bold text-amber-400"
                            style={{ fontFamily: 'var(--font-mono)' }}
                        >
                            {task.progress.toFixed(1)}%
                        </span>
                        <div className="flex items-center gap-3 text-[10px] text-gray-400"
                            style={{ fontFamily: 'var(--font-mono)' }}>
                            <span className="text-emerald-400">↓ {task.speed}</span>
                            <span>ETA: {task.eta}</span>
                        </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full bg-gradient-to-r from-amber-500 to-amber-400 rounded-full"
                            style={{
                                boxShadow: '0 0 12px rgba(245, 158, 11, 0.5)',
                            }}
                            initial={{ width: 0 }}
                            animate={{ width: `${task.progress}%` }}
                            transition={{ duration: 0.3, ease: 'easeOut' }}
                        />
                    </div>
                </div>
            )}

            {/* Processing state with indeterminate progress */}
            {task.status === 'processing' && (
                <div className="mt-3">
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <motion.div
                            className="h-full w-1/3 bg-gradient-to-r from-sky-500 to-sky-400 rounded-full"
                            animate={{ x: ['0%', '200%'] }}
                            transition={{
                                duration: 1.5,
                                repeat: Infinity,
                                ease: 'easeInOut'
                            }}
                            style={{
                                boxShadow: '0 0 12px rgba(14, 165, 233, 0.5)',
                            }}
                        />
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1.5 text-center"
                        style={{ fontFamily: 'var(--font-mono)' }}>
                        Merging video and audio streams with FFmpeg...
                    </p>
                </div>
            )}

            {/* Error Message */}
            {hasError && task.error && (
                <div className="mt-2 p-2 bg-red-950/30 rounded border border-red-500/20">
                    <p className="text-xs text-red-400" style={{ fontFamily: 'var(--font-mono)' }}>
                        {task.error}
                    </p>
                </div>
            )}
        </motion.div>
    );
}

// Action Button Component
interface ActionButtonProps {
    icon: React.ElementType;
    tooltip: string;
    onClick?: () => void;
    variant?: 'default' | 'success' | 'danger';
}

function ActionButton({ icon: Icon, tooltip, onClick, variant = 'default' }: ActionButtonProps) {
    const variantClasses = {
        default: 'hover:bg-gray-700 text-gray-400 hover:text-gray-200',
        success: 'hover:bg-emerald-900/50 text-emerald-400 hover:text-emerald-300',
        danger: 'hover:bg-red-900/50 text-red-400 hover:text-red-300',
    };

    return (
        <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClick}
            className={`
                p-1.5 rounded-md transition-colors
                ${variantClasses[variant]}
            `}
            title={tooltip}
        >
            <Icon size={14} />
        </motion.button>
    );
}

// Utility function
function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}


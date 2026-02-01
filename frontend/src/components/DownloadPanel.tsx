import { motion, AnimatePresence } from 'framer-motion';
import { Download, History, Film, Music, Folder, Trash2, Play, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useState } from 'react';
import type { DownloadTask, CompletedDownload } from '../store/useAppStore';

export function DownloadPanel() {
    const {
        downloadQueue,
        videoHistory,
        audioHistory,
        removeFromHistory,
        removeFromQueue
    } = useAppStore();

    const [activeTab, setActiveTab] = useState<'downloads' | 'history'>('downloads');
    const [historyFilter, setHistoryFilter] = useState<'all' | 'video' | 'audio'>('all');

    const activeDownloads = downloadQueue.filter(
        t => ['queued', 'fetching_info', 'downloading', 'processing'].includes(t.status)
    );



    const handleOpenFile = (filepath: string) => {
        window.electronAPI?.openPath(filepath);
    };

    const handleOpenFolder = (filepath: string) => {
        window.electronAPI?.showItemInFolder(filepath);
    };

    const getFilteredHistory = () => {
        if (historyFilter === 'video') return videoHistory;
        if (historyFilter === 'audio') return audioHistory;
        return [...videoHistory, ...audioHistory].sort(
            (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
        );
    };

    return (
        <div className="glass-card flex flex-col h-full">
            {/* Tab Header */}
            <div className="flex items-center gap-2 p-4 border-b border-border">
                <TabButton
                    active={activeTab === 'downloads'}
                    onClick={() => setActiveTab('downloads')}
                    icon={Download}
                    label="Downloads"
                    count={activeDownloads.length}
                />
                <TabButton
                    active={activeTab === 'history'}
                    onClick={() => setActiveTab('history')}
                    icon={History}
                    label="History"
                    count={videoHistory.length + audioHistory.length}
                />
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-4">
                <AnimatePresence mode="wait">
                    {activeTab === 'downloads' && (
                        <motion.div
                            key="downloads"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-3"
                        >
                            {downloadQueue.length === 0 ? (
                                <EmptyState
                                    icon={Download}
                                    title="No downloads yet"
                                    description="Downloads will appear here"
                                />
                            ) : (
                                downloadQueue.map((task) => (
                                    <DownloadCard
                                        key={task.task_id}
                                        task={task}
                                        onOpenFile={() => handleOpenFile(task.filepath)}
                                        onOpenFolder={() => handleOpenFolder(task.filepath)}
                                        onRemove={() => removeFromQueue(task.task_id)}
                                    />
                                ))
                            )}
                        </motion.div>
                    )}

                    {activeTab === 'history' && (
                        <motion.div
                            key="history"
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 10 }}
                            className="space-y-4"
                        >
                            {/* Filter Buttons */}
                            <div className="flex gap-2">
                                <FilterChip
                                    active={historyFilter === 'all'}
                                    onClick={() => setHistoryFilter('all')}
                                    label="All"
                                    count={videoHistory.length + audioHistory.length}
                                />
                                <FilterChip
                                    active={historyFilter === 'video'}
                                    onClick={() => setHistoryFilter('video')}
                                    label="Videos"
                                    count={videoHistory.length}
                                    icon={Film}
                                />
                                <FilterChip
                                    active={historyFilter === 'audio'}
                                    onClick={() => setHistoryFilter('audio')}
                                    label="Audios"
                                    count={audioHistory.length}
                                    icon={Music}
                                />
                            </div>

                            {/* History Items */}
                            <div className="space-y-2">
                                {getFilteredHistory().length === 0 ? (
                                    <EmptyState
                                        icon={History}
                                        title="No history yet"
                                        description="Completed downloads will appear here"
                                    />
                                ) : (
                                    <AnimatePresence mode="popLayout">
                                        {getFilteredHistory().map((item) => (
                                            <HistoryCard
                                                key={item.id}
                                                item={item}
                                                onOpen={() => handleOpenFile(item.filepath)}
                                                onOpenFolder={() => handleOpenFolder(item.filepath)}
                                                onDelete={() => removeFromHistory(item.id)}
                                            />
                                        ))}
                                    </AnimatePresence>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

// Tab Button
function TabButton({ active, onClick, icon: Icon, label, count }: {
    active: boolean;
    onClick: () => void;
    icon: React.ElementType;
    label: string;
    count?: number;
}) {
    return (
        <button
            onClick={onClick}
            className={`
                flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                transition-all duration-200
                ${active
                    ? 'bg-accent-primary/20 text-accent-primary'
                    : 'text-text-muted hover:text-text-secondary hover:bg-bg-tertiary'
                }
            `}
            style={{ fontFamily: 'var(--font-display)' }}
        >
            <Icon size={16} />
            <span>{label}</span>
            {count !== undefined && count > 0 && (
                <span className={`
                    px-1.5 py-0.5 rounded-full text-[10px] font-bold
                    ${active ? 'bg-accent-primary/20' : 'bg-bg-tertiary'}
                `}>
                    {count}
                </span>
            )}
        </button>
    );
}

// Filter Chip
function FilterChip({ active, onClick, label, count, icon: Icon }: {
    active: boolean;
    onClick: () => void;
    label: string;
    count: number;
    icon?: React.ElementType;
}) {
    return (
        <button
            onClick={onClick}
            className={`
                flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                transition-all duration-200 border
                ${active
                    ? 'bg-accent-primary/15 text-accent-primary border-accent-primary/30'
                    : 'bg-transparent text-text-muted border-border hover:border-border-hover'
                }
            `}
        >
            {Icon && <Icon size={12} />}
            <span>{label}</span>
            <span className="opacity-60">{count}</span>
        </button>
    );
}

// Download Card
function DownloadCard({ task, onOpenFile, onOpenFolder, onRemove }: {
    task: DownloadTask;
    onOpenFile: () => void;
    onOpenFolder: () => void;
    onRemove: () => void;
}) {
    const isActive = ['downloading', 'processing', 'queued'].includes(task.status);
    const isCompleted = task.status === 'completed';
    const hasError = task.status === 'error';

    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className={`download-card ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''} ${hasError ? 'error' : ''}`}
        >
            {/* Thumbnail */}
            <div className="w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-bg-tertiary">
                {task.thumbnail ? (
                    <img src={task.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        {task.format_type === 'video' ? (
                            <Film size={20} className="text-text-muted" />
                        ) : (
                            <Music size={20} className="text-text-muted" />
                        )}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate mb-1">
                    {task.title || 'Loading...'}
                </p>

                {/* Status Row */}
                <div className="flex items-center gap-2">
                    <StatusBadge status={task.status} />
                    {isActive && task.speed !== '0 B/s' && (
                        <span className="text-xs text-text-muted">{task.speed}</span>
                    )}
                </div>

                {/* Progress Bar */}
                {task.status === 'downloading' && (
                    <div className="mt-2">
                        <div className="progress-track">
                            <div
                                className="progress-fill"
                                style={{ width: `${task.progress}%` }}
                            />
                        </div>
                        <div className="flex justify-between mt-1">
                            <span className="text-xs text-accent-primary font-medium">{task.progress.toFixed(1)}%</span>
                            <span className="text-xs text-text-muted">{task.eta}</span>
                        </div>
                    </div>
                )}

                {/* Processing Indicator */}
                {task.status === 'processing' && (
                    <div className="mt-2">
                        <div className="progress-track">
                            <div className="progress-fill progress-indeterminate w-1/3" />
                        </div>
                    </div>
                )}

                {/* Error Message */}
                {hasError && task.error && (
                    <p className="text-xs text-error mt-1 truncate">{task.error}</p>
                )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1">
                {isCompleted && (
                    <>
                        <ActionButton icon={Play} onClick={onOpenFile} tooltip="Open" />
                        <ActionButton icon={Folder} onClick={onOpenFolder} tooltip="Folder" />
                    </>
                )}
                <ActionButton icon={Trash2} onClick={onRemove} tooltip="Remove" variant="danger" />
            </div>
        </motion.div>
    );
}

// History Card
function HistoryCard({ item, onOpen, onOpenFolder, onDelete }: {
    item: CompletedDownload;
    onOpen: () => void;
    onOpenFolder: () => void;
    onDelete: () => void;
}) {
    const timeStr = new Date(item.completed_at).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
    });

    return (
        <motion.div
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex items-center gap-3 p-3 rounded-lg bg-bg-secondary/50 border border-border hover:border-border-hover transition-all group"
        >
            {/* Thumbnail */}
            <div className="w-10 h-8 rounded overflow-hidden flex-shrink-0 bg-bg-tertiary">
                {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        {item.format_type === 'video' ? '🎬' : '🎵'}
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{item.title}</p>
                <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="uppercase">{item.format}</span>
                    <span>•</span>
                    <span>{timeStr}</span>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ActionButton icon={Play} onClick={onOpen} tooltip="Open" size="sm" />
                <ActionButton icon={Folder} onClick={onOpenFolder} tooltip="Folder" size="sm" />
                <ActionButton icon={Trash2} onClick={onDelete} tooltip="Delete" variant="danger" size="sm" />
            </div>
        </motion.div>
    );
}

// Status Badge
function StatusBadge({ status }: { status: string }) {
    const config: Record<string, { icon: React.ElementType; label: string; className: string }> = {
        queued: { icon: Loader2, label: 'Queued', className: 'badge-info' },
        downloading: { icon: Download, label: 'Downloading', className: 'badge-warning' },
        processing: { icon: Loader2, label: 'Processing', className: 'badge-info' },
        completed: { icon: Check, label: 'Complete', className: 'badge-success' },
        error: { icon: AlertCircle, label: 'Error', className: 'badge-error' },
    };

    const { icon: Icon, label, className } = config[status] || config.queued;

    return (
        <span className={`badge ${className}`}>
            <Icon size={10} className={status === 'queued' || status === 'processing' ? 'animate-spin' : ''} />
            {label}
        </span>
    );
}

// Action Button
function ActionButton({ icon: Icon, onClick, tooltip, variant = 'default', size = 'md' }: {
    icon: React.ElementType;
    onClick: () => void;
    tooltip: string;
    variant?: 'default' | 'danger';
    size?: 'sm' | 'md';
}) {
    return (
        <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
            onClick={onClick}
            title={tooltip}
            className={`
                btn-icon
                ${size === 'sm' ? 'w-7 h-7' : 'w-8 h-8'}
                ${variant === 'danger' ? 'hover:text-error hover:bg-error/10' : ''}
            `}
        >
            <Icon size={size === 'sm' ? 12 : 14} />
        </motion.button>
    );
}

// Empty State
function EmptyState({ icon: Icon, title, description }: {
    icon: React.ElementType;
    title: string;
    description: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-bg-tertiary flex items-center justify-center mb-4">
                <Icon className="w-7 h-7 text-text-muted" />
            </div>
            <p className="text-sm font-medium text-text-secondary mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                {title}
            </p>
            <p className="text-xs text-text-muted">{description}</p>
        </div>
    );
}

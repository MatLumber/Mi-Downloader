import { motion } from 'framer-motion';
import { X, Loader2, CheckCircle2, AlertTriangle, Play, FolderOpen } from 'lucide-react';
import { MediaThumb } from './MediaThumb';
import { formatBytes, getFileName, shortenPath } from '../../lib/format';

export type FileQueueStatus = 'pending' | 'processing' | 'completed' | 'error' | 'cancelled';
export type FileQueueKind = 'video' | 'audio' | 'image';

interface FileQueueItemProps {
    id: string;
    path: string;
    size?: number | null;
    kind: FileQueueKind;
    status: FileQueueStatus;
    progress?: number;
    error?: string | null;
    outputPath?: string;
    onRemove?: () => void;
}

export function FileQueueItem({
    id, path, size, kind, status, progress = 0, error, outputPath, onRemove,
}: FileQueueItemProps) {
    return (
        <motion.div
            layout
            data-id={id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -10 }}
            className={`fileq-item is-${status}`}
        >
            <MediaThumb className="fileq-thumb" localPath={path} kind={kind} />

            <div className="fileq-info">
                <div className="fileq-title" title={path}>{getFileName(path)}</div>
                <div className="fileq-meta">
                    <span className="fileq-path">{shortenPath(path, 3)}</span>
                    {size != null && size > 0 && (
                        <>
                            <span>·</span>
                            <span>{formatBytes(size)}</span>
                        </>
                    )}
                </div>

                {status === 'processing' && (
                    <div className="fileq-progress-row">
                        <div className="progress" style={{ flex: 1 }}>
                            <div className="progress-fill" style={{ width: `${progress}%` }} />
                        </div>
                        <span className="progress-percent" style={{ fontSize: 11, minWidth: 38, textAlign: 'right' }}>
                            {Math.round(progress)}%
                        </span>
                    </div>
                )}
                {status === 'error' && error && (
                    <div className="fileq-error">{error}</div>
                )}
            </div>

            <div className="fileq-actions">
                {status === 'completed' && (
                    <span className="fileq-status-icon is-success" title="Completado">
                        <CheckCircle2 size={14} strokeWidth={2.2} />
                    </span>
                )}
                {status === 'error' && (
                    <span className="fileq-status-icon is-error" title={error || 'Error'}>
                        <AlertTriangle size={14} strokeWidth={2.2} />
                    </span>
                )}
                {status === 'processing' && (
                    <span className="fileq-status-icon is-active" title="Procesando">
                        <Loader2 size={14} className="animate-spin" />
                    </span>
                )}

                {status === 'completed' && outputPath && (
                    <>
                        <button className="btn-icon" title="Abrir" onClick={() => window.electronAPI?.openPath(outputPath)}>
                            <Play size={13} strokeWidth={1.8} />
                        </button>
                        <button className="btn-icon" title="Mostrar en carpeta" onClick={() => window.electronAPI?.showItemInFolder(outputPath)}>
                            <FolderOpen size={13} strokeWidth={1.8} />
                        </button>
                    </>
                )}

                {onRemove && status !== 'processing' && (
                    <button className="btn-icon is-danger" onClick={onRemove} title="Quitar">
                        <X size={13} strokeWidth={2} />
                    </button>
                )}
            </div>
        </motion.div>
    );
}

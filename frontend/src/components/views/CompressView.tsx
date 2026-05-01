import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Layers, X, FolderOpen, Cpu, Play, Trash2, Plus, UploadCloud } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import {
    fetchCompressionEncoders,
    fetchCompressionStatus,
    startCompression,
    subscribeToCompressionEvents,
    cancelCompression,
} from '../../api/client';
import { useFileDrop } from '../../hooks/useFileDrop';
import { GlobalDropOverlay } from '../shared/DropZone';
import { PathPicker } from '../shared/PathPicker';
import { useToast } from '../../hooks/useToast';
import { formatBytes, formatRelativeTime, getFileName } from '../../lib/format';
import { FileQueueItem } from '../shared/FileQueueItem';
import { MediaThumb } from '../shared/MediaThumb';

const COMPRESS_FORMATS = ['mp4', 'mkv', 'webm'] as const;
const VIDEO_DROP_FORMATS = ['MP4', 'MKV', 'WEBM', 'AVI', 'MOV', 'M4V'];

const PRESET_OPTIONS = [
    { id: 'high', label: 'Alta', desc: 'Máxima calidad. Reducción moderada.' },
    { id: 'balanced', label: 'Balanceada', desc: 'Buena calidad, peso menor.' },
    { id: 'light', label: 'Ligera', desc: 'Máximo ahorro de espacio.' },
] as const;

const PRESET_RATIO = { high: 0.75, balanced: 0.55, light: 0.35 } as const;

export function CompressView() {
    const {
        downloadPath,
        compressionPreset, setCompressionPreset,
        compressionFormat, setCompressionFormat,
        compressionUseGpu, setCompressionUseGpu,
        compressionOutputDir, setCompressionOutputDir,
        compressionHistory, addCompressionHistory, removeCompressionHistory, clearCompressionHistory,
        compressQueue, addCompressFiles, updateCompressFile, removeCompressFile,
        clearCompletedCompressFiles,
    } = useAppStore();

    const files = compressQueue;
    const toast = useToast();
    const [outputFormat, setOutputFormat] = useState<typeof COMPRESS_FORMATS[number]>(compressionFormat);
    const [preset, setPreset] = useState(compressionPreset);
    const [encoderInfo, setEncoderInfo] = useState<{ available: boolean; best: string | null } | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const cancelRef = useRef(false);

    const outputDir = compressionOutputDir || downloadPath;

    const addFiles = (paths: string[]) => {
        if (paths.length === 0) return;
        // Resolve sizes async — dedupe is handled inside the store action
        const beforeIds = new Set(compressQueue.map((f) => f.id));
        addCompressFiles(paths);
        // Pick up the freshly added files (they're the ones not in beforeIds)
        setTimeout(() => {
            const current = useAppStore.getState().compressQueue;
            const fresh = current.filter((f) => !beforeIds.has(f.id) && f.size === null);
            for (const f of fresh) {
                window.electronAPI?.statFile?.(f.path).then((r) => {
                    if (r?.size) updateCompressFile(f.id, { size: r.size });
                });
            }
        }, 0);
    };

    const { isDragging } = useFileDrop({
        enabled: !isProcessing,
        kind: 'video',
        onDrop: (paths) => addFiles(paths),
        onReject: (msg) => toast.push('error', 'Archivo no válido', msg),
    });

    useEffect(() => {
        let active = true;
        fetchCompressionEncoders()
            .then((data) => {
                if (!active) return;
                setEncoderInfo({ available: data.available, best: data.best });
                if (data.available) setCompressionUseGpu(true);
            })
            .catch(() => active && setEncoderInfo({ available: false, best: null }));
        return () => { active = false; };
    }, [setCompressionUseGpu]);

    const handleSelectFiles = async () => {
        const paths = await window.electronAPI?.selectFiles?.('video');
        if (paths && paths.length > 0) addFiles(paths);
    };

    const handleSelectOutput = async () => {
        const dir = await window.electronAPI?.selectDirectory?.();
        if (dir) setCompressionOutputDir(dir);
    };

    const handleRemove = (id: string) => {
        removeCompressFile(id);
    };

    const handleClearCompleted = () => {
        clearCompletedCompressFiles();
    };

    const totalInputSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const estimatedTotal = totalInputSize ? totalInputSize * (PRESET_RATIO[preset] ?? 0.6) : 0;

    const pendingCount = files.filter((f) => f.status === 'pending' || f.status === 'error').length;
    const processingCount = files.filter((f) => f.status === 'processing').length;
    const completedCount = files.filter((f) => f.status === 'completed').length;

    const compressOne = (fileId: string) => new Promise<void>((resolve) => {
        const file = useAppStore.getState().compressQueue.find((f) => f.id === fileId);
        if (!file) return resolve();

        setActiveTaskId(null);
        updateCompressFile(fileId, { status: 'processing', progress: 0, error: null });

        let lastEvent = Date.now();
        let pollHandle: number | null = null;

        startCompression(file.path, outputDir, outputFormat, preset, compressionUseGpu)
            .then((response) => {
                setActiveTaskId(response.task_id);

                pollHandle = window.setInterval(async () => {
                    if (Date.now() - lastEvent < 1500) return;
                    try {
                        const status = await fetchCompressionStatus(response.task_id);
                        updateCompressFile(fileId, { progress: status.progress });
                    } catch { /* ignore */ }
                }, 1200);

                subscribeToCompressionEvents(
                    response.task_id,
                    (data) => {
                        lastEvent = Date.now();
                        updateCompressFile(fileId, { progress: data.progress });
                        if (data.status === 'completed') {
                            const outPath = data.output_path;
                            window.electronAPI?.statFile?.(outPath).then((r) => {
                                updateCompressFile(fileId, {
                                    status: 'completed',
                                    progress: 100,
                                    output_path: outPath,
                                    output_size: r?.size ?? null,
                                });
                                addCompressionHistory({
                                    id: crypto.randomUUID(),
                                    title: getFileName(outPath) || 'archivo comprimido',
                                    input_path: file.path,
                                    output_path: outPath,
                                    format: outputFormat,
                                    preset,
                                    used_gpu: compressionUseGpu,
                                    input_size: file.size,
                                    output_size: r?.size ?? null,
                                    completed_at: new Date(),
                                });
                            });
                        }
                        if (data.status === 'error') {
                            updateCompressFile(fileId, { status: 'error', error: data.error || 'Error al comprimir' });
                        }
                    },
                    (error) => {
                        updateCompressFile(fileId, { status: 'error', error: error.message });
                        if (pollHandle) window.clearInterval(pollHandle);
                        resolve();
                    },
                    () => {
                        if (pollHandle) window.clearInterval(pollHandle);
                        resolve();
                    },
                );
            })
            .catch((error) => {
                updateCompressFile(fileId, { status: 'error', error: (error as Error).message });
                if (pollHandle) window.clearInterval(pollHandle);
                resolve();
            });
    });

    const handleStart = async () => {
        if (isProcessing) return;
        const queue = useAppStore.getState().compressQueue.filter(
            (f) => f.status === 'pending' || f.status === 'error',
        );
        if (queue.length === 0) {
            toast.push('info', 'Nada que comprimir', 'Agrega al menos un video.');
            return;
        }
        setIsProcessing(true);
        cancelRef.current = false;
        toast.push('info', `Comprimiendo ${queue.length} ${queue.length === 1 ? 'archivo' : 'archivos'}`, 'Procesados uno a uno por el motor.');

        for (const file of queue) {
            if (cancelRef.current) break;
            // re-check (user may have removed it from the UI)
            const stillThere = useAppStore.getState().compressQueue.find((f) => f.id === file.id);
            if (!stillThere) continue;
            await compressOne(file.id);
        }

        setIsProcessing(false);
        setActiveTaskId(null);
        const ok = useAppStore.getState().compressQueue.filter((f) => f.status === 'completed').length;
        if (ok > 0) toast.push('success', 'Compresión completada', `${ok} ${ok === 1 ? 'archivo' : 'archivos'} listo${ok === 1 ? '' : 's'}.`);
    };

    const handleCancelAll = () => {
        cancelRef.current = true;
        if (activeTaskId) cancelCompression(activeTaskId).catch(() => { });
        setIsProcessing(false);
        setActiveTaskId(null);
        for (const f of useAppStore.getState().compressQueue) {
            if (f.status === 'processing') updateCompressFile(f.id, { status: 'cancelled', error: 'Cancelado' });
        }
    };

    return (
        <div className="content-inner">
            <GlobalDropOverlay visible={isDragging} label={`Compresor · ${VIDEO_DROP_FORMATS.join(' · ')}`} />

            <header className="page-header">
                <div className="page-eyebrow">Comprimir</div>
                <h1 className="page-title">Reducir el peso sin perder lo esencial</h1>
                <p className="page-subtitle">
                    Elige uno o varios videos. Procesamos en orden por el motor FFmpeg, con aceleración por GPU si tu sistema lo soporta.
                </p>
            </header>

            <div className="stack-loose">
                {/* File queue */}
                <div className="surface surface-pad">
                    <div className="section-h">
                        <span className="section-title">Archivos a comprimir</span>
                        <span className="section-eyebrow">Paso 1 · {files.length} {files.length === 1 ? 'archivo' : 'archivos'}</span>
                    </div>

                    {files.length === 0 ? (
                        <button
                            type="button"
                            onClick={handleSelectFiles}
                            className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
                        >
                            <div className="dropzone-icon">
                                <UploadCloud size={22} strokeWidth={1.7} />
                            </div>
                            <div>
                                <div className="dropzone-title">{isDragging ? 'Suelta para cargar' : 'Arrastra videos aquí'}</div>
                                <div className="dropzone-sub">o haz clic para elegir uno o varios archivos</div>
                            </div>
                            <div className="dropzone-formats">
                                {VIDEO_DROP_FORMATS.map((f) => <span key={f} className="dropzone-format">{f}</span>)}
                            </div>
                        </button>
                    ) : (
                        <div className="stack-tight">
                            <div className="fileq-list">
                                <AnimatePresence mode="popLayout">
                                    {files.map((file) => (
                                        <FileQueueItem
                                            key={file.id}
                                            id={file.id}
                                            path={file.path}
                                            size={file.size}
                                            kind="video"
                                            status={file.status}
                                            progress={file.progress}
                                            error={file.error}
                                            outputPath={file.output_path}
                                            onRemove={() => handleRemove(file.id)}
                                        />
                                    ))}
                                </AnimatePresence>
                            </div>

                            <button
                                type="button"
                                onClick={handleSelectFiles}
                                className={`dropzone is-compact ${isDragging ? 'is-dragging' : ''}`}
                                disabled={isProcessing}
                            >
                                <div className="dropzone-icon">
                                    <Plus size={18} strokeWidth={2} />
                                </div>
                                <div>
                                    <div className="dropzone-title">Agregar más</div>
                                    <div className="dropzone-sub">Arrastra o haz clic</div>
                                </div>
                            </button>
                        </div>
                    )}
                </div>

                {/* Quality preset */}
                <div className="surface surface-pad">
                    <div className="section-h">
                        <span className="section-title">Calidad</span>
                        <span className="section-eyebrow">Paso 2 · se aplica a todos</span>
                    </div>
                    <div className="preset-row">
                        {PRESET_OPTIONS.map((option) => (
                            <button
                                key={option.id}
                                className={`preset-tile ${preset === option.id ? 'is-active' : ''}`}
                                onClick={() => {
                                    setPreset(option.id);
                                    setCompressionPreset(option.id);
                                }}
                                disabled={isProcessing}
                            >
                                <span className="preset-tile-name">{option.label}</span>
                                <span className="preset-tile-desc">{option.desc}</span>
                            </button>
                        ))}
                    </div>
                    {totalInputSize > 0 && estimatedTotal > 0 && (
                        <div className="estimate" style={{ marginTop: 12 }}>
                            <span>Estimado total:</span>
                            <strong>{formatBytes(totalInputSize)}</strong>
                            <span className="estimate-arrow">→</span>
                            <strong>{formatBytes(estimatedTotal)}</strong>
                            <span>· ahorro {Math.round((1 - estimatedTotal / totalInputSize) * 100)}%</span>
                        </div>
                    )}
                </div>

                {/* Output options */}
                <div className="surface surface-pad">
                    <div className="section-h">
                        <span className="section-title">Salida</span>
                        <span className="section-eyebrow">Paso 3</span>
                    </div>
                    <div className="split-2">
                        <div className="field">
                            <label className="field-label">Contenedor</label>
                            <div className="chip-grid">
                                {COMPRESS_FORMATS.map((f) => (
                                    <button
                                        key={f}
                                        className={`chip ${outputFormat === f ? 'is-active' : ''}`}
                                        onClick={() => {
                                            setOutputFormat(f);
                                            setCompressionFormat(f);
                                        }}
                                        disabled={isProcessing}
                                    >
                                        {f}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="field">
                            <label className="field-label">Aceleración GPU</label>
                            <button
                                type="button"
                                className={`gpu-toggle ${compressionUseGpu ? 'is-active' : ''} ${encoderInfo?.available ? '' : 'is-disabled'}`}
                                onClick={() => encoderInfo?.available && setCompressionUseGpu(!compressionUseGpu)}
                                disabled={isProcessing || !encoderInfo?.available}
                            >
                                <div className="gpu-switch" />
                                <div className="gpu-text">
                                    <div className="gpu-name">{compressionUseGpu ? 'Activada' : 'Desactivada'}</div>
                                    <div className="gpu-meta">
                                        {encoderInfo?.available
                                            ? `Encoder: ${encoderInfo.best || 'auto'}`
                                            : 'Sin GPU compatible detectada'}
                                    </div>
                                </div>
                                <Cpu size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
                            </button>
                        </div>
                    </div>
                    <div style={{ marginTop: 14 }}>
                        <PathPicker label="Carpeta de salida" value={outputDir} onPick={handleSelectOutput} disabled={isProcessing} />
                    </div>
                </div>

                {/* Action row */}
                <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
                    <div className="text-mute" style={{ fontSize: 13 }}>
                        {isProcessing ? (
                            `Procesando ${processingCount}/${pendingCount + processingCount + completedCount}…`
                        ) : completedCount > 0 && pendingCount === 0 ? (
                            <span style={{ color: 'var(--emerald)' }}>Todos los archivos comprimidos.</span>
                        ) : files.length === 0 ? (
                            'Agrega uno o más videos para comenzar.'
                        ) : (
                            `${pendingCount} ${pendingCount === 1 ? 'archivo' : 'archivos'} en cola.`
                        )}
                    </div>
                    <div className="row">
                        {completedCount > 0 && !isProcessing && (
                            <button className="btn btn-ghost" onClick={handleClearCompleted}>
                                <X size={13} />
                                <span>Quitar completados</span>
                            </button>
                        )}
                        {isProcessing ? (
                            <button className="btn btn-danger btn-xl" onClick={handleCancelAll}>
                                <X size={14} strokeWidth={2.2} />
                                <span>Cancelar</span>
                            </button>
                        ) : (
                            <button className="btn btn-primary btn-xl" onClick={handleStart} disabled={pendingCount === 0}>
                                <Layers size={16} strokeWidth={2.2} />
                                <span>{pendingCount > 0 ? `Comprimir ${pendingCount}` : 'Comprimir'}</span>
                            </button>
                        )}
                    </div>
                </div>

                {/* History — recent compressions */}
                {compressionHistory.length > 0 && (
                    <div>
                        <div className="section-h">
                            <span className="section-eyebrow">Compresiones recientes</span>
                            <button className="text-link" onClick={clearCompressionHistory}>
                                Vaciar todo
                            </button>
                        </div>
                        <div className="history-list">
                            <AnimatePresence mode="popLayout">
                                {compressionHistory.slice(0, 8).map((entry) => {
                                    const savings = entry.input_size && entry.output_size
                                        ? Math.round((1 - entry.output_size / entry.input_size) * 100)
                                        : null;
                                    return (
                                        <motion.div
                                            key={entry.id}
                                            layout
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, x: -10 }}
                                            className="history-item"
                                        >
                                            <MediaThumb
                                                className="history-thumb"
                                                localPath={entry.output_path}
                                                kind="compression"
                                            />
                                            <div className="history-info">
                                                <div className="history-title" title={entry.title}>{entry.title}</div>
                                                <div className="history-meta">
                                                    <span className="format-tag">{entry.format}</span>
                                                    <span>{entry.preset}</span>
                                                    {entry.used_gpu && <span style={{ color: 'var(--amber-deep)' }}>GPU</span>}
                                                    {entry.input_size && entry.output_size && (
                                                        <>
                                                            <span>·</span>
                                                            <span>{formatBytes(entry.input_size)} → <strong style={{ color: 'var(--ink-soft)' }}>{formatBytes(entry.output_size)}</strong></span>
                                                            {savings != null && savings > 0 && (
                                                                <span style={{ color: 'var(--emerald)' }}>−{savings}%</span>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                            <span className="history-date">{formatRelativeTime(entry.completed_at)}</span>
                                            <div className="history-actions">
                                                <button className="btn-icon" onClick={() => entry.output_path && window.electronAPI?.openPath(entry.output_path)} title="Abrir archivo">
                                                    <Play size={14} strokeWidth={1.8} />
                                                </button>
                                                <button className="btn-icon" onClick={() => entry.output_path && window.electronAPI?.showItemInFolder(entry.output_path)} title="Mostrar en carpeta">
                                                    <FolderOpen size={14} strokeWidth={1.8} />
                                                </button>
                                                <button className="btn-icon is-danger" onClick={() => removeCompressionHistory(entry.id)} title="Quitar">
                                                    <Trash2 size={14} strokeWidth={1.8} />
                                                </button>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

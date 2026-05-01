import { useRef, useState } from 'react';
import { Repeat, X, Play, FolderOpen, Trash2, Plus, UploadCloud } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/useAppStore';
import {
    fetchLocalInfo,
    startConvert,
    subscribeToConvertEvents,
    cancelConvert,
} from '../../api/client';
import type { DropKind } from '../../hooks/useFileDrop';
import { useFileDrop } from '../../hooks/useFileDrop';
import { GlobalDropOverlay } from '../shared/DropZone';
import { PathPicker } from '../shared/PathPicker';
import { useToast } from '../../hooks/useToast';
import { formatBytes, formatRelativeTime, getDirName, getFileName } from '../../lib/format';
import { FileQueueItem } from '../shared/FileQueueItem';
import type { FileQueueKind } from '../shared/FileQueueItem';
import { MediaThumb } from '../shared/MediaThumb';

const CONVERT_VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'] as const;
const CONVERT_AUDIO_FORMATS = ['mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a'] as const;
const CONVERT_IMAGE_FORMATS = ['png', 'jpg', 'webp', 'bmp', 'tiff'] as const;
const AUDIO_BITRATES = ['320', '256', '192', '128'] as const;

const VIDEO_DROP = ['MP4', 'MKV', 'WEBM', 'MOV', 'AVI', 'M4V'];
const AUDIO_DROP = ['MP3', 'AAC', 'WAV', 'FLAC', 'OGG', 'OPUS', 'M4A', 'MP4', 'MKV', 'WEBM'];
const IMAGE_DROP = ['PNG', 'JPG', 'WEBP', 'BMP', 'TIFF'];

const QUALITY_OPTIONS = [
    { value: 'high', label: 'Alta' },
    { value: 'balanced', label: 'Balanceada' },
    { value: 'light', label: 'Ligera' },
] as const;

type Tab = 'video' | 'audio' | 'image';

export function ConvertView() {
    const convertTab = useAppStore((s) => s.convertTab);
    const setConvertTab = useAppStore((s) => s.setConvertTab);

    return (
        <div className="content-inner">
            <header className="page-header">
                <div className="page-eyebrow">Convertir</div>
                <h1 className="page-title">Cambia de formato sin perder fidelidad</h1>
                <p className="page-subtitle">
                    Convierte uno o varios archivos al formato que necesites. Procesados en orden por el motor FFmpeg.
                </p>
            </header>

            <div className="seg is-block" style={{ marginBottom: 22 }}>
                {(['video', 'audio', 'image'] as const).map((t) => (
                    <button
                        key={t}
                        className={`seg-item ${convertTab === t ? 'is-active' : ''}`}
                        onClick={() => setConvertTab(t)}
                    >
                        {t === 'video' ? 'Video' : t === 'audio' ? 'Audio' : 'Imagen'}
                    </button>
                ))}
            </div>

            <AnimatePresence mode="wait">
                <motion.div
                    key={convertTab}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                >
                    <ConvertPanel kind={convertTab} />
                </motion.div>
            </AnimatePresence>

            <ConvertHistory tab={convertTab} />
        </div>
    );
}

function ConvertPanel({ kind }: { kind: Tab }) {
    const toast = useToast();
    const {
        convertVideoFormat, setConvertVideoFormat,
        convertAudioFormat, setConvertAudioFormat,
        convertImageFormat, setConvertImageFormat,
        convertVideoQuality, setConvertVideoQuality,
        convertAudioQuality, setConvertAudioQuality,
        convertImageQuality, setConvertImageQuality,
        convertOutputDir, setConvertOutputDir,
        addConvertHistory,
        convertQueue, addConvertFiles, updateConvertFile, removeConvertFile,
        clearCompletedConvertFiles,
    } = useAppStore();

    const files = convertQueue;
    const [isProcessing, setIsProcessing] = useState(false);
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const cancelRef = useRef(false);

    const dropKind: DropKind = kind === 'video' ? 'video' : kind === 'audio' ? 'media' : 'image';
    const fileQueueKind: FileQueueKind = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
    const dropFormats = kind === 'video' ? VIDEO_DROP : kind === 'audio' ? AUDIO_DROP : IMAGE_DROP;
    const fileSelectKind = kind === 'video' ? 'video' : kind === 'audio' ? 'media' : 'image';

    const addFiles = async (paths: string[]) => {
        if (paths.length === 0) return;
        const beforeIds = new Set(useAppStore.getState().convertQueue.map((f) => f.id));
        addConvertFiles(paths);
        const fresh = useAppStore.getState().convertQueue.filter((f) => !beforeIds.has(f.id));
        if (!convertOutputDir && fresh.length > 0) {
            setConvertOutputDir(getDirName(fresh[0].path));
        }
        for (const f of fresh) {
            try {
                const info = await fetchLocalInfo(f.path);
                updateConvertFile(f.id, { size: info.size, duration: info.duration });
            } catch { /* ignore */ }
        }
    };

    const { isDragging } = useFileDrop({
        enabled: !isProcessing,
        kind: dropKind,
        onDrop: (paths) => addFiles(paths),
        onReject: (msg) => toast.push('error', 'Archivo no válido', msg),
    });

    const handlePick = async () => {
        const paths = await window.electronAPI?.selectFiles?.(fileSelectKind);
        if (paths && paths.length > 0) addFiles(paths);
    };

    const handleSelectOutput = async () => {
        const dir = await window.electronAPI?.selectDirectory?.();
        if (dir) setConvertOutputDir(dir);
    };

    const handleRemove = (id: string) => {
        removeConvertFile(id);
    };

    const handleClearCompleted = () => {
        clearCompletedConvertFiles();
    };

    const format = kind === 'video' ? convertVideoFormat : kind === 'audio' ? convertAudioFormat : convertImageFormat;
    const quality = kind === 'video' ? convertVideoQuality : kind === 'audio' ? convertAudioQuality : convertImageQuality;
    const formats = kind === 'video' ? CONVERT_VIDEO_FORMATS : kind === 'audio' ? CONVERT_AUDIO_FORMATS : CONVERT_IMAGE_FORMATS;

    const setFormat = (value: string) => {
        if (kind === 'video') setConvertVideoFormat(value as typeof convertVideoFormat);
        else if (kind === 'audio') setConvertAudioFormat(value as typeof convertAudioFormat);
        else setConvertImageFormat(value as typeof convertImageFormat);
    };

    const setQuality = (value: string) => {
        if (kind === 'video') setConvertVideoQuality(value as typeof convertVideoQuality);
        else if (kind === 'audio') setConvertAudioQuality(value as typeof convertAudioQuality);
        else setConvertImageQuality(value as typeof convertImageQuality);
    };

    const totalInputSize = files.reduce((sum, f) => sum + (f.size || 0), 0);
    const pendingCount = files.filter((f) => f.status === 'pending' || f.status === 'error').length;
    const processingCount = files.filter((f) => f.status === 'processing').length;
    const completedCount = files.filter((f) => f.status === 'completed').length;

    const convertOne = (fileId: string) => new Promise<void>((resolve) => {
        const file = useAppStore.getState().convertQueue.find((f) => f.id === fileId);
        if (!file) return resolve();

        updateConvertFile(fileId, { status: 'processing', progress: 0, error: null });

        startConvert(
            file.path,
            convertOutputDir || getDirName(file.path),
            format,
            kind,
            String(quality),
        ).then((response) => {
            setActiveTaskId(response.task_id);
            subscribeToConvertEvents(
                response.task_id,
                (data) => {
                    updateConvertFile(fileId, { progress: data.progress });
                    if (data.status === 'completed') {
                        updateConvertFile(fileId, {
                            status: 'completed',
                            progress: 100,
                            output_path: data.output_path,
                        });
                        addConvertHistory({
                            id: crypto.randomUUID(),
                            title: getFileName(data.output_path || file.path),
                            input_path: file.path,
                            output_path: data.output_path || '',
                            format,
                            media_type: kind,
                            completed_at: new Date(),
                        });
                    }
                    if (data.status === 'error') {
                        updateConvertFile(fileId, { status: 'error', error: data.error || 'Error al convertir' });
                    }
                },
                (error) => {
                    updateConvertFile(fileId, { status: 'error', error: error.message });
                    resolve();
                },
                () => resolve(),
            );
        }).catch((error) => {
            updateConvertFile(fileId, { status: 'error', error: (error as Error).message });
            resolve();
        });
    });

    const handleStart = async () => {
        if (isProcessing) return;
        const queue = useAppStore.getState().convertQueue.filter(
            (f) => f.status === 'pending' || f.status === 'error',
        );
        if (queue.length === 0) {
            toast.push('info', 'Nada que convertir', 'Agrega al menos un archivo.');
            return;
        }
        setIsProcessing(true);
        cancelRef.current = false;
        toast.push('info', `Convirtiendo ${queue.length} ${queue.length === 1 ? 'archivo' : 'archivos'}`, 'En orden, uno por uno.');

        for (const file of queue) {
            if (cancelRef.current) break;
            const stillThere = useAppStore.getState().convertQueue.find((f) => f.id === file.id);
            if (!stillThere) continue;
            await convertOne(file.id);
        }

        setIsProcessing(false);
        setActiveTaskId(null);
        const ok = useAppStore.getState().convertQueue.filter((f) => f.status === 'completed').length;
        if (ok > 0) toast.push('success', 'Conversión completada', `${ok} ${ok === 1 ? 'archivo' : 'archivos'} listo${ok === 1 ? '' : 's'}.`);
    };

    const handleCancelAll = () => {
        cancelRef.current = true;
        if (activeTaskId) cancelConvert(activeTaskId).catch(() => { });
        setIsProcessing(false);
        setActiveTaskId(null);
        for (const f of useAppStore.getState().convertQueue) {
            if (f.status === 'processing') updateConvertFile(f.id, { status: 'cancelled', error: 'Cancelado' });
        }
    };

    return (
        <div className="stack-loose">
            <GlobalDropOverlay visible={isDragging} label={`Convertir · ${dropFormats.join(' · ')}`} />

            {/* File queue */}
            <div className="surface surface-pad">
                <div className="section-h">
                    <span className="section-title">Archivos a convertir</span>
                    <span className="section-eyebrow">{files.length} {files.length === 1 ? 'archivo' : 'archivos'}</span>
                </div>

                {files.length === 0 ? (
                    <button
                        type="button"
                        onClick={handlePick}
                        className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
                    >
                        <div className="dropzone-icon">
                            <UploadCloud size={22} strokeWidth={1.7} />
                        </div>
                        <div>
                            <div className="dropzone-title">{isDragging ? 'Suelta para cargar' : `Arrastra ${kind === 'image' ? 'imágenes' : kind === 'audio' ? 'audios o videos' : 'videos'} aquí`}</div>
                            <div className="dropzone-sub">o haz clic para elegir uno o varios archivos</div>
                        </div>
                        <div className="dropzone-formats">
                            {dropFormats.map((f) => <span key={f} className="dropzone-format">{f}</span>)}
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
                                        kind={fileQueueKind}
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
                            onClick={handlePick}
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

            {/* Format + quality */}
            <div className="surface surface-pad">
                <div className="section-h">
                    <span className="section-title">Formato y calidad</span>
                    <span className="section-eyebrow">Se aplica a todos</span>
                </div>
                <div className="split-2">
                    <div className="field">
                        <label className="field-label">Formato de salida</label>
                        <div className="chip-grid">
                            {formats.map((f) => (
                                <button
                                    key={f}
                                    className={`chip ${format === f ? 'is-active' : ''}`}
                                    onClick={() => setFormat(f)}
                                    disabled={isProcessing}
                                >
                                    {f}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="field">
                        <label className="field-label">Calidad</label>
                        <div className="chip-grid">
                            {kind === 'audio' ? (
                                AUDIO_BITRATES.map((b) => (
                                    <button
                                        key={b}
                                        className={`chip ${convertAudioQuality === b ? 'is-active' : ''}`}
                                        onClick={() => setConvertAudioQuality(b)}
                                        disabled={isProcessing}
                                    >
                                        {b} kbps
                                    </button>
                                ))
                            ) : (
                                QUALITY_OPTIONS.map((q) => (
                                    <button
                                        key={q.value}
                                        className={`chip ${quality === q.value ? 'is-active' : ''}`}
                                        onClick={() => setQuality(q.value)}
                                        disabled={isProcessing}
                                    >
                                        {q.label}
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {totalInputSize > 0 && (
                    <div className="estimate" style={{ marginTop: 14 }}>
                        <span>Tamaño total:</span>
                        <strong>{formatBytes(totalInputSize)}</strong>
                    </div>
                )}

                <div style={{ marginTop: 14 }}>
                    <PathPicker label="Carpeta de salida" value={convertOutputDir} onPick={handleSelectOutput} disabled={isProcessing} />
                </div>
            </div>

            {/* Action row */}
            <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
                <div className="text-mute" style={{ fontSize: 13 }}>
                    {isProcessing ? (
                        `Procesando ${processingCount}/${pendingCount + processingCount + completedCount}…`
                    ) : completedCount > 0 && pendingCount === 0 ? (
                        <span style={{ color: 'var(--emerald)' }}>Todos los archivos convertidos.</span>
                    ) : files.length === 0 ? (
                        'Agrega uno o más archivos para comenzar.'
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
                            <Repeat size={16} strokeWidth={2.2} />
                            <span>{pendingCount > 0 ? `Convertir ${pendingCount}` : 'Convertir'}</span>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

function ConvertHistory({ tab }: { tab: Tab }) {
    const convertHistory = useAppStore((s) => s.convertHistory);
    const removeConvertHistory = useAppStore((s) => s.removeConvertHistory);
    const items = convertHistory.filter((e) => e.media_type === tab);

    if (items.length === 0) return null;

    return (
        <div style={{ marginTop: 30 }}>
            <div className="section-h">
                <span className="section-eyebrow">Recientes · {tab}</span>
                <span className="section-title">{items.length} {items.length === 1 ? 'conversión' : 'conversiones'}</span>
            </div>
            <div className="history-list">
                <AnimatePresence mode="popLayout">
                    {items.slice(0, 8).map((entry) => (
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
                                kind={entry.media_type}
                            />
                            <div className="history-info">
                                <div className="history-title">{entry.title}</div>
                                <div className="history-meta">
                                    <span className="format-tag">{entry.format}</span>
                                </div>
                            </div>
                            <span className="history-date">{formatRelativeTime(entry.completed_at)}</span>
                            <div className="history-actions">
                                <button className="btn-icon" onClick={() => entry.output_path && window.electronAPI?.openPath(entry.output_path)} title="Abrir">
                                    <Play size={14} />
                                </button>
                                <button className="btn-icon" onClick={() => entry.output_path && window.electronAPI?.showItemInFolder(entry.output_path)} title="Mostrar en carpeta">
                                    <FolderOpen size={14} />
                                </button>
                                <button className="btn-icon is-danger" onClick={() => removeConvertHistory(entry.id)} title="Quitar">
                                    <Trash2 size={14} />
                                </button>
                            </div>
                        </motion.div>
                    ))}
                </AnimatePresence>
            </div>
        </div>
    );
}

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Search, Loader2, Download, Film, Music, Play, FolderOpen,
    Trash2, X, Eye, Link as LinkIcon, ListVideo, Check,
    AlertTriangle, KeyRound, RotateCw,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { DownloadTask, PlaylistEntry } from '../../store/useAppStore';
import {
    fetchVideoInfo, startDownload, subscribeToTaskEvents, cancelDownload,
} from '../../api/client';
import { getPlatformIcon, getPlatformLabel, resolveThumbnail, detectPlatform } from '../../lib/platforms';
import { formatDuration, formatBytes, getFileName } from '../../lib/format';
import { parseError } from '../../lib/errorMap';
import { StatusBadge } from '../shared/StatusBadge';
import { PathPicker } from '../shared/PathPicker';
import { useToast } from '../../hooks/useToast';

const VIDEO_FORMATS = ['mp4', 'mkv', 'avi', 'webm'] as const;
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'opus'] as const;
const VIDEO_QUALITIES = [
    { value: 'best', label: 'Mejor disponible' },
    { value: '1080', label: '1080p · Full HD' },
    { value: '720', label: '720p · HD' },
    { value: '480', label: '480p · SD' },
    { value: '360', label: '360p · Baja' },
];
const AUDIO_BITRATES = [
    { value: '320', label: '320 kbps · Estudio' },
    { value: '256', label: '256 kbps · Premium' },
    { value: '192', label: '192 kbps · Estándar' },
    { value: '128', label: '128 kbps · Ligera' },
];

export function DownloaderView() {
    const {
        url, urlValid, setUrl,
        videoInfo, setVideoInfo, loadingInfo, setLoadingInfo,
        formatType, setFormatType,
        quality, setQuality,
        videoFormat, setVideoFormat,
        audioFormat, setAudioFormat,
        audioQuality, setAudioQuality,
        downloadPath, setDownloadPath,
        downloadQueue, addToQueue, updateTask, removeFromQueue,
        addToHistory,
        apiOnline,
        useBrowserCookies,
        cookiesBrowser, cookiesFile, setActiveTab,
    } = useAppStore();

    const [isDownloading, setIsDownloading] = useState(false);
    const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
    const toast = useToast();

    const platform = detectPlatform(url || videoInfo?.platform);
    const isPlaylist = !!videoInfo?.is_playlist && (videoInfo?.entries?.length ?? 0) > 0;
    const entries = useMemo(() => videoInfo?.entries ?? [], [videoInfo?.entries]);

    const handleFetch = async () => {
        if (!url.trim() || urlValid === false || loadingInfo || !apiOnline) return;
        setLoadingInfo(true);
        setVideoInfo(null);
        setSelectedEntries(new Set());
        try {
            const info = await fetchVideoInfo(url);
            setVideoInfo(info);
            // Auto-select all playlist items by default for convenience
            if (info.is_playlist && info.entries) {
                setSelectedEntries(new Set(info.entries.map((e) => e.id)));
            }
        } catch (error) {
            toast.push('error', 'No pudimos analizar el enlace', (error as Error).message);
        } finally {
            setLoadingInfo(false);
        }
    };

    const buildAbsolutePath = useCallback((filename: string): string => {
        if (!filename) return '';
        if (filename.startsWith('~') || filename.includes(':\\') || filename.startsWith('/')) return filename;
        const sep = downloadPath.includes('\\') ? '\\' : '/';
        return `${downloadPath}${sep}${filename}`;
    }, [downloadPath]);

    const enqueueDownload = useCallback((
        sourceUrl: string,
        taskTitle: string,
        taskThumbnail: string,
        detectedPlatform: string,
        outputFormat: string,
        opts?: { forceCookies?: boolean; formatTypeOverride?: 'video' | 'audio'; qualityOverride?: string; audioQualityOverride?: string },
    ) => new Promise<void>((resolve, reject) => {
        const effectiveFormat = opts?.formatTypeOverride || formatType;
        const effectiveQuality = opts?.qualityOverride || quality;
        const effectiveAudioBitrate = opts?.audioQualityOverride || audioQuality;
        const effectiveUseCookies = !!opts?.forceCookies || useBrowserCookies;

        // A configured cookies.txt file overrides the browser source — yt-dlp reads
        // the file and we never have to touch the browser's encrypted cookie DB.
        const effectiveCookiesFile = effectiveUseCookies ? (cookiesFile || null) : null;

        startDownload({
            url: sourceUrl,
            formatType: effectiveFormat,
            quality: effectiveQuality,
            outputPath: downloadPath,
            outputFormat,
            audioQuality: effectiveFormat === 'audio' ? effectiveAudioBitrate : undefined,
            useCookies: effectiveUseCookies,
            cookiesBrowser: effectiveUseCookies && !effectiveCookiesFile ? cookiesBrowser : null,
            cookiesFile: effectiveCookiesFile,
        }).then((response) => {
            const newTask: DownloadTask = {
                task_id: response.task_id,
                status: 'queued',
                progress: 0,
                speed: '0 B/s',
                eta: 'Iniciando…',
                filename: '',
                filepath: '',
                title: taskTitle,
                thumbnail: taskThumbnail,
                platform: detectedPlatform,
                format_type: effectiveFormat,
                quality: effectiveQuality,
                error: null,
                started_at: new Date(),
                filesize: null,
                source_url: sourceUrl,
                used_cookies: effectiveUseCookies,
                audio_quality: effectiveAudioBitrate,
                output_format: outputFormat,
            };
            addToQueue(newTask);

            subscribeToTaskEvents(
                response.task_id,
                (data) => {
                    const fullPath = data.filename ? buildAbsolutePath(data.filename) : '';
                    updateTask(response.task_id, {
                        ...data,
                        status: data.status as DownloadTask['status'],
                        filepath: fullPath,
                        title: data.title || taskTitle,
                    });
                    if (data.status === 'completed') {
                        addToHistory({
                            id: data.task_id,
                            title: data.title || taskTitle,
                            thumbnail: taskThumbnail,
                            filename: getFileName(data.filename) || 'archivo',
                            filepath: fullPath,
                            platform: detectedPlatform,
                            format_type: effectiveFormat,
                            format: outputFormat,
                            filesize: 0,
                            completed_at: new Date(),
                        });
                        toast.push('success', 'Descarga completada', taskTitle);
                    } else if (data.status === 'error') {
                        const parsed = parseError(data.error);
                        toast.push('error', parsed.title, parsed.hint);
                    }
                },
                () => { },
                () => { },
            );
            resolve();
        }).catch(reject);
    }), [
        formatType, quality, audioQuality, downloadPath, useBrowserCookies, cookiesBrowser, cookiesFile,
        addToQueue, updateTask, addToHistory, toast, buildAbsolutePath,
    ]);

    const handleRetryWithCookies = useCallback((task: DownloadTask) => {
        if (!task.source_url) {
            toast.push('error', 'No se puede reintentar', 'Falta la URL de origen.');
            return;
        }
        // Per-task cookies override only — we do NOT flip the global useBrowserCookies
        // toggle. Doing so silently changed the user's preference for every future
        // download, which is confusing. forceCookies enables cookies just for this attempt.
        removeFromQueue(task.task_id);
        enqueueDownload(
            task.source_url,
            task.title,
            task.thumbnail,
            task.platform || 'other',
            task.output_format || (task.format_type === 'audio' ? 'mp3' : 'mp4'),
            {
                forceCookies: true,
                formatTypeOverride: task.format_type,
                qualityOverride: task.quality,
                audioQualityOverride: task.audio_quality,
            },
        ).catch((err) => toast.push('error', 'No se pudo reintentar', (err as Error).message));
    }, [removeFromQueue, enqueueDownload, toast]);

    // Plain retry — re-runs with the same settings the original task used. If the
    // failed task didn't use cookies, the retry won't enable them; if it did, it keeps
    // them. Combined with backend .part cleanup, this guarantees a clean re-download
    // (no resumed/corrupt fragments).
    const handleRetry = useCallback((task: DownloadTask) => {
        if (!task.source_url) {
            toast.push('error', 'No se puede reintentar', 'Falta la URL de origen.');
            return;
        }
        removeFromQueue(task.task_id);
        enqueueDownload(
            task.source_url,
            task.title,
            task.thumbnail,
            task.platform || 'other',
            task.output_format || (task.format_type === 'audio' ? 'mp3' : 'mp4'),
            {
                forceCookies: !!task.used_cookies,
                formatTypeOverride: task.format_type,
                qualityOverride: task.quality,
                audioQualityOverride: task.audio_quality,
            },
        ).catch((err) => toast.push('error', 'No se pudo reintentar', (err as Error).message));
    }, [removeFromQueue, enqueueDownload, toast]);

    const handleOpenSettings = useCallback(() => {
        setActiveTab('settings');
    }, [setActiveTab]);

    const handleDownloadSingle = async () => {
        if (!videoInfo || isDownloading) return;
        setIsDownloading(true);
        const outputFormat = formatType === 'video' ? videoFormat : audioFormat;
        const detectedPlatform = videoInfo.platform || 'other';
        const sourceUrl = url || (videoInfo.id.startsWith('http')
            ? videoInfo.id
            : `https://www.youtube.com/watch?v=${videoInfo.id}`);

        try {
            await enqueueDownload(
                sourceUrl,
                videoInfo.title,
                videoInfo.thumbnail || '',
                detectedPlatform,
                outputFormat,
            );
            setVideoInfo(null);
            setUrl('');
        } catch (error) {
            toast.push('error', 'No se pudo iniciar la descarga', (error as Error).message);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleDownloadPlaylist = async () => {
        if (!videoInfo || !videoInfo.entries || isDownloading) return;
        const targets = videoInfo.entries.filter((e) => selectedEntries.has(e.id));
        if (targets.length === 0) {
            toast.push('info', 'Sin selección', 'Selecciona al menos un video de la playlist.');
            return;
        }
        setIsDownloading(true);
        const outputFormat = formatType === 'video' ? videoFormat : audioFormat;
        const detectedPlatform = videoInfo.platform || 'other';

        toast.push('info', `Encolando ${targets.length} ${targets.length === 1 ? 'video' : 'videos'}`, 'Las descargas se procesarán en paralelo.');

        for (const entry of targets) {
            try {
                await enqueueDownload(
                    entry.url,
                    entry.title,
                    entry.thumbnail || '',
                    detectedPlatform,
                    outputFormat,
                );
            } catch (error) {
                toast.push('error', `Falló: ${entry.title}`, (error as Error).message);
            }
        }
        setVideoInfo(null);
        setUrl('');
        setSelectedEntries(new Set());
        setIsDownloading(false);
    };

    const handleSelectDirectory = async () => {
        const path = await window.electronAPI?.selectDirectory?.();
        if (path) setDownloadPath(path);
    };

    const toggleEntry = (id: string) => {
        setSelectedEntries((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const totalSelected = selectedEntries.size;
    const allSelected = isPlaylist && entries.length > 0 && totalSelected === entries.length;

    const totalDuration = useMemo(() => {
        if (!isPlaylist) return 0;
        return entries
            .filter((e) => selectedEntries.has(e.id))
            .reduce((sum, e) => sum + (e.duration || 0), 0);
    }, [entries, selectedEntries, isPlaylist]);

    return (
        <div className="content-inner">
            <header className="page-header">
                <div className="page-eyebrow">Descargar</div>
                <h1 className="page-title">Captura de medios</h1>
                <p className="page-subtitle">
                    Pega un enlace de YouTube, TikTok, Instagram, Facebook, X, Twitch — incluso playlists completas — y descarga en alta fidelidad.
                </p>
            </header>

            <div className="stack-loose">
                {/* URL bar */}
                <div>
                    <div className={`urlbar ${urlValid === true ? 'is-valid' : urlValid === false ? 'is-invalid' : ''}`}>
                        <div className="urlbar-icon">
                            {url ? getPlatformIcon(url, 18) : <LinkIcon size={18} strokeWidth={1.7} />}
                        </div>
                        <input
                            type="text"
                            className="urlbar-input"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                            placeholder="https://youtube.com/watch?v=…  o  /playlist?list=…"
                            disabled={loadingInfo}
                            spellCheck={false}
                        />
                        <button
                            type="button"
                            className="urlbar-button"
                            onClick={handleFetch}
                            disabled={!urlValid || loadingInfo || !apiOnline}
                        >
                            {loadingInfo ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} strokeWidth={2} />}
                            <span>{loadingInfo ? 'Analizando' : 'Analizar'}</span>
                        </button>
                    </div>
                    <div className="urlbar-meta">
                        <div className="urlbar-meta-platforms">
                            <span>YouTube</span>
                            <span>·</span>
                            <span>Playlists</span>
                            <span>·</span>
                            <span>TikTok</span>
                            <span>·</span>
                            <span>Instagram</span>
                            <span>·</span>
                            <span>X</span>
                            <span>·</span>
                            <span>Facebook</span>
                            <span>·</span>
                            <span>Twitch</span>
                        </div>
                        {url.length > 0 && urlValid !== null && (
                            <span className={`urlbar-validity ${urlValid ? 'is-valid' : 'is-invalid'}`}>
                                {urlValid ? `· ${getPlatformLabel(platform)}` : '· No reconocido'}
                            </span>
                        )}
                    </div>
                </div>

                {/* Preview + format options */}
                <AnimatePresence mode="wait">
                    {videoInfo ? (
                        <motion.div
                            key="preview"
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.22 }}
                            className="stack"
                        >
                            {isPlaylist ? (
                                <PlaylistView
                                    info={videoInfo}
                                    entries={entries}
                                    selected={selectedEntries}
                                    onToggle={toggleEntry}
                                    onSelectAll={() => setSelectedEntries(new Set(entries.map((e) => e.id)))}
                                    onSelectNone={() => setSelectedEntries(new Set())}
                                    allSelected={allSelected}
                                    totalDuration={totalDuration}
                                />
                            ) : (
                                <SingleVideoView info={videoInfo} />
                            )}

                            <div className="surface surface-pad">
                                <div className="format-grid">
                                    <button
                                        className={`format-tile ${formatType === 'video' ? 'is-active' : ''}`}
                                        onClick={() => setFormatType('video')}
                                    >
                                        <div className="format-tile-icon">
                                            <Film size={18} strokeWidth={1.7} />
                                        </div>
                                        <div className="format-tile-text">
                                            <div className="format-tile-name">Video</div>
                                            <div className="format-tile-sub">Imagen + audio</div>
                                        </div>
                                    </button>
                                    <button
                                        className={`format-tile ${formatType === 'audio' ? 'is-active' : ''}`}
                                        onClick={() => setFormatType('audio')}
                                    >
                                        <div className="format-tile-icon">
                                            <Music size={18} strokeWidth={1.7} />
                                        </div>
                                        <div className="format-tile-text">
                                            <div className="format-tile-name">Solo audio</div>
                                            <div className="format-tile-sub">Extracción a mp3, flac, wav…</div>
                                        </div>
                                    </button>
                                </div>

                                <div className="split-2" style={{ marginBottom: 18 }}>
                                    {formatType === 'video' ? (
                                        <>
                                            <div className="field">
                                                <label className="field-label">Calidad</label>
                                                <select className="select-native" value={quality} onChange={(e) => setQuality(e.target.value)}>
                                                    {VIDEO_QUALITIES.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
                                                </select>
                                            </div>
                                            <div className="field">
                                                <label className="field-label">Contenedor</label>
                                                <div className="chip-grid">
                                                    {VIDEO_FORMATS.map((f) => (
                                                        <button
                                                            key={f}
                                                            className={`chip ${videoFormat === f ? 'is-active' : ''}`}
                                                            onClick={() => setVideoFormat(f)}
                                                        >
                                                            {f}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="field">
                                                <label className="field-label">Bitrate</label>
                                                <select className="select-native" value={audioQuality} onChange={(e) => setAudioQuality(e.target.value as typeof audioQuality)}>
                                                    {AUDIO_BITRATES.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                                                </select>
                                            </div>
                                            <div className="field">
                                                <label className="field-label">Formato</label>
                                                <div className="chip-grid">
                                                    {AUDIO_FORMATS.map((f) => (
                                                        <button
                                                            key={f}
                                                            className={`chip ${audioFormat === f ? 'is-active' : ''}`}
                                                            onClick={() => setAudioFormat(f)}
                                                        >
                                                            {f}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className="row" style={{ flexWrap: 'wrap', gap: 12 }}>
                                    <div style={{ flex: 1, minWidth: 220 }}>
                                        <PathPicker label="Destino" value={downloadPath} onPick={handleSelectDirectory} />
                                    </div>
                                    {isPlaylist ? (
                                        <button
                                            type="button"
                                            className="btn btn-primary btn-xl"
                                            onClick={handleDownloadPlaylist}
                                            disabled={isDownloading || totalSelected === 0}
                                        >
                                            {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <ListVideo size={16} strokeWidth={2.2} />}
                                            <span>{isDownloading ? 'Encolando' : `Descargar ${totalSelected || ''}`.trim()}</span>
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            className="btn btn-primary btn-xl"
                                            onClick={handleDownloadSingle}
                                            disabled={isDownloading}
                                        >
                                            {isDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} strokeWidth={2.2} />}
                                            <span>{isDownloading ? 'Procesando' : 'Descargar'}</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </motion.div>
                    ) : !loadingInfo && (
                        <motion.div
                            key="empty"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="surface empty"
                        >
                            <div className="empty-mark">
                                <Eye size={22} strokeWidth={1.6} />
                            </div>
                            <div className="empty-title">Listo para analizar</div>
                            <div className="empty-sub">
                                Pega cualquier enlace de medios o playlist en la barra superior y pulsa <span className="kbd">Enter</span>.
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                {/* Active queue */}
                {downloadQueue.length > 0 && (
                    <div>
                        <div className="section-h">
                            <span className="section-eyebrow">Cola</span>
                            <span className="section-title">{downloadQueue.length} {downloadQueue.length === 1 ? 'descarga' : 'descargas'}</span>
                        </div>
                        <div className="stack-tight">
                            <AnimatePresence mode="popLayout">
                                {downloadQueue.map((task) => (
                                    <QueueCard
                                        key={task.task_id}
                                        task={task}
                                        onCancel={() => {
                                            cancelDownload(task.task_id).catch(() => { });
                                            removeFromQueue(task.task_id);
                                        }}
                                        onRemove={() => removeFromQueue(task.task_id)}
                                        onOpen={() => task.filepath && window.electronAPI?.openPath(task.filepath)}
                                        onShowFolder={() => task.filepath && window.electronAPI?.showItemInFolder(task.filepath)}
                                        onRetry={() => handleRetry(task)}
                                        onRetryWithCookies={() => handleRetryWithCookies(task)}
                                        onOpenSettings={handleOpenSettings}
                                    />
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function SingleVideoView({ info }: { info: ReturnType<typeof useAppStore.getState>['videoInfo'] }) {
    if (!info) return null;
    return (
        <div className="surface">
            <div className="preview">
                <div className="preview-thumb">
                    {info.thumbnail ? (
                        <img src={resolveThumbnail(info.thumbnail, info.platform)} alt="" />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <Film size={28} />
                        </div>
                    )}
                    <span className="preview-duration">{formatDuration(info.duration)}</span>
                </div>
                <div className="preview-meta">
                    <div className="preview-platform-row">
                        <span className="preview-platform">
                            {getPlatformIcon(info.platform, 12)}
                            {getPlatformLabel(info.platform)}
                        </span>
                        <span className="preview-channel">{info.channel || 'Canal desconocido'}</span>
                    </div>
                    <h2 className="preview-title">{info.title}</h2>
                    <div className="preview-stats">
                        {info.view_count != null && <span>{info.view_count.toLocaleString('es')} vistas</span>}
                        {info.formats?.length > 0 && (
                            <>
                                <span>·</span>
                                <span>{info.formats.length} formatos disponibles</span>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

interface PlaylistViewProps {
    info: NonNullable<ReturnType<typeof useAppStore.getState>['videoInfo']>;
    entries: PlaylistEntry[];
    selected: Set<string>;
    onToggle: (id: string) => void;
    onSelectAll: () => void;
    onSelectNone: () => void;
    allSelected: boolean;
    totalDuration: number;
}

function PlaylistView({ info, entries, selected, onToggle, onSelectAll, onSelectNone, allSelected, totalDuration }: PlaylistViewProps) {
    return (
        <div className="stack-tight">
            <div className="playlist-summary">
                <div className="playlist-thumb">
                    {info.thumbnail ? (
                        <img src={resolveThumbnail(info.thumbnail, info.platform)} alt="" />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                            <ListVideo size={20} />
                        </div>
                    )}
                    <div className="playlist-thumb-stack">
                        <span className="playlist-thumb-count">{entries.length}</span>
                    </div>
                </div>
                <div className="playlist-info">
                    <div className="playlist-eyebrow">
                        {getPlatformLabel(info.platform)} · Playlist
                    </div>
                    <div className="playlist-title">{info.title}</div>
                    <div className="playlist-channel">{info.channel || 'Canal desconocido'} · {entries.length} {entries.length === 1 ? 'video' : 'videos'}</div>
                </div>
            </div>

            <div className="playlist-actions-bar">
                <span className="playlist-selection-info">
                    {selected.size} de {entries.length} seleccionados
                    {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
                </span>
                <div className="playlist-mini-actions">
                    <button className="text-link" onClick={allSelected ? onSelectNone : onSelectAll}>
                        {allSelected ? 'Quitar todos' : 'Seleccionar todos'}
                    </button>
                </div>
            </div>

            <div className="playlist-list">
                {entries.map((entry, idx) => {
                    const isSelected = selected.has(entry.id);
                    return (
                        <button
                            key={entry.id || idx}
                            type="button"
                            className={`playlist-row ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => onToggle(entry.id)}
                        >
                            <div className="playlist-check">
                                {isSelected && <Check size={12} strokeWidth={2.6} />}
                            </div>
                            <div className="playlist-row-thumb">
                                {entry.thumbnail ? (
                                    <img src={resolveThumbnail(entry.thumbnail, info.platform)} alt="" loading="lazy" />
                                ) : (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                                        <Film size={14} />
                                    </div>
                                )}
                            </div>
                            <div className="playlist-row-info">
                                <div className="playlist-row-title">{entry.title}</div>
                                <div className="playlist-row-meta">{formatDuration(entry.duration)}</div>
                            </div>
                            <span className="playlist-row-num">{String(idx + 1).padStart(2, '0')}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

interface QueueCardProps {
    task: DownloadTask;
    onCancel: () => void;
    onRemove: () => void;
    onOpen: () => void;
    onShowFolder: () => void;
    onRetry: () => void;
    onRetryWithCookies: () => void;
    onOpenSettings: () => void;
}

function QueueCard({ task, onCancel, onRemove, onOpen, onShowFolder, onRetry, onRetryWithCookies, onOpenSettings }: QueueCardProps) {
    const [showRawError, setShowRawError] = useState(false);
    const isActive = ['downloading', 'processing', 'fetching_info', 'queued'].includes(task.status);
    const isCompleted = task.status === 'completed';
    const isError = task.status === 'error';
    const parsed = isError ? parseError(task.error) : null;

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -16 }}
            className={`task-card ${isActive ? 'is-active' : ''} ${isError ? 'is-error' : ''}`}
        >
            <div className="task-thumb">
                {task.thumbnail ? (
                    <img src={resolveThumbnail(task.thumbnail, task.platform)} alt="" />
                ) : task.format_type === 'audio' ? (
                    <Music size={20} />
                ) : (
                    <Film size={20} />
                )}
                <span className="task-thumb-quality">{task.quality === 'best' ? 'BEST' : `${task.quality}p`}</span>
            </div>

            <div className="task-info">
                <div className="task-title" title={task.title}>{task.title || 'Cargando…'}</div>
                <div className="task-meta">
                    <StatusBadge status={task.status} />
                    {task.platform && <span>{getPlatformLabel(task.platform)}</span>}
                    {task.used_cookies && (
                        <>
                            <span className="task-meta-sep">·</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--amber-deep)' }}>
                                <KeyRound size={10} strokeWidth={2} />
                                cookies
                            </span>
                        </>
                    )}
                    {task.status === 'downloading' && (
                        <>
                            <span className="task-meta-sep">·</span>
                            <span>{task.speed}</span>
                            <span className="task-meta-sep">·</span>
                            <span>ETA {task.eta}</span>
                        </>
                    )}
                </div>

                {task.status === 'downloading' && (
                    <div style={{ marginTop: 6 }}>
                        <div className="progress">
                            <div className="progress-fill" style={{ width: `${task.progress}%` }} />
                        </div>
                        <div className="progress-meta">
                            <span className="progress-percent">{task.progress.toFixed(1)}%</span>
                            <span>{formatBytes((task.filesize || 0) * (task.progress / 100))}/{formatBytes(task.filesize || 0)}</span>
                        </div>
                    </div>
                )}
                {task.status === 'processing' && (
                    <div style={{ marginTop: 6 }}>
                        <div className="progress is-indeterminate">
                            <div className="progress-fill" />
                        </div>
                    </div>
                )}

                {isError && parsed && (
                    <div className="error-panel">
                        <div className="error-panel-head">
                            <span className="error-panel-icon">
                                <AlertTriangle size={13} strokeWidth={2.2} />
                            </span>
                            <div>
                                <div className="error-panel-title">{parsed.title}</div>
                                <div className="error-panel-hint">{parsed.hint}</div>
                            </div>
                        </div>
                        <div className="error-panel-actions">
                            {task.source_url && (
                                <button className="btn btn-primary" onClick={onRetry}>
                                    <RotateCw size={12} strokeWidth={2} />
                                    <span>Reintentar</span>
                                </button>
                            )}
                            {parsed.canRetryWithCookies && task.source_url && !task.used_cookies && (
                                <button className="btn btn-ghost" onClick={onRetryWithCookies}>
                                    <KeyRound size={12} strokeWidth={2} />
                                    <span>Reintentar con cookies</span>
                                </button>
                            )}
                            {parsed.canRetryWithCookies && task.used_cookies && (
                                <span className="error-panel-note">
                                    Las cookies activadas no resolvieron el error. Verifica que tu sesión del navegador tenga acceso a este contenido.
                                </span>
                            )}
                            <button className="btn btn-ghost" onClick={onOpenSettings}>
                                <KeyRound size={12} strokeWidth={2} />
                                <span>Ajustes de cookies</span>
                            </button>
                            {parsed.raw && parsed.raw !== parsed.hint && (
                                <button className="text-link" onClick={() => setShowRawError((v) => !v)}>
                                    {showRawError ? 'Ocultar detalle' : 'Ver detalle técnico'}
                                </button>
                            )}
                        </div>
                        {showRawError && parsed.raw && (
                            <pre className="error-panel-raw">{parsed.raw}</pre>
                        )}
                    </div>
                )}
            </div>

            <div className="task-actions">
                {isCompleted && (
                    <>
                        <button className="btn-icon" onClick={onOpen} title="Abrir archivo">
                            <Play size={14} strokeWidth={1.8} />
                        </button>
                        <button className="btn-icon" onClick={onShowFolder} title="Mostrar en carpeta">
                            <FolderOpen size={14} strokeWidth={1.8} />
                        </button>
                    </>
                )}
                {isActive && task.status !== 'queued' && (
                    <button className="btn-icon is-danger" onClick={onCancel} title="Cancelar">
                        <X size={14} strokeWidth={2} />
                    </button>
                )}
                <button className="btn-icon is-danger" onClick={onRemove} title="Quitar de la lista">
                    <Trash2 size={14} strokeWidth={1.8} />
                </button>
            </div>
        </motion.div>
    );
}

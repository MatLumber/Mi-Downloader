import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Link, Search, Loader2, Film, Music, Download,
    FolderOpen, Play, Trash2, SlidersHorizontal,
    Youtube, Instagram, Facebook, Twitter, Twitch,
    History, MonitorPlay, Headphones, Repeat, Image
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import {
    API_BASE,
    fetchCompressionEncoders,
    fetchCompressionStatus,
    fetchLocalInfo,
    fetchVideoInfo,
    startConvert,
    subscribeToConvertEvents,
    startCompression,
    startDownload,
    subscribeToCompressionEvents,
    subscribeToTaskEvents,
} from '../api/client';
import type { DownloadTask } from '../store/useAppStore';



const VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'avi'] as const;
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'opus'] as const;
const VIDEO_QUALITIES = ['best', '1080', '720', '480', '360'] as const;
const AUDIO_BITRATES = ['320', '256', '192', '128'] as const;
const COMPRESS_FORMATS = ['mp4', 'mkv', 'webm'] as const;
const CONVERT_VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v'] as const;
const CONVERT_AUDIO_FORMATS = ['mp3', 'aac', 'wav', 'flac', 'ogg', 'opus', 'm4a'] as const;
const CONVERT_IMAGE_FORMATS = ['png', 'jpg', 'webp', 'bmp', 'tiff'] as const;

const getPlatformIcon = (text: string | undefined, size: number = 20) => {
    const lower = (text || '').toLowerCase();
    if (lower.includes('youtube') || lower.includes('youtu.be')) return <Youtube size={size} className="text-red-500" />;
    if (lower.includes('instagram')) return <Instagram size={size} className="text-pink-500" />;
    if (lower.includes('facebook') || lower.includes('fb.watch')) return <Facebook size={size} className="text-blue-500" />;
    if (lower.includes('twitter') || lower.includes('x.com')) return <Twitter size={size} className="text-sky-500" />;
    if (lower.includes('twitch')) return <Twitch size={size} className="text-purple-500" />;
    if (lower.includes('tiktok')) return <Music size={size} className="text-cyan-400" />;
    return <Link size={size} className="text-zinc-500" />;
};

const resolveThumbnail = (thumbnail: string | null, platform?: string) => {
    if (!thumbnail) return '';
    const name = (platform || '').toLowerCase();
    if (name === 'instagram' || name === 'facebook') {
        return `${API_BASE}/thumbnail?url=${encodeURIComponent(thumbnail)}`;
    }
    return thumbnail;
};



export function MainPanel() {
    const { activeTab, setActiveTab } = useAppStore();

    return (
        <div className="flex flex-col items-center justify-start w-full">
            {/* ===== FLOATING NAVBAR ===== */}
            <nav className="floating-nav mt-3 mb-10">
                <NavButton
                    active={activeTab === 'queue'}
                    onClick={() => setActiveTab('queue')}
                    icon={<Download size={18} />}
                    label="Descargar"
                />
                <NavButton
                    active={activeTab === 'compress'}
                    onClick={() => setActiveTab('compress')}
                    icon={<SlidersHorizontal size={18} />}
                    label="Compresor"
                />
                <NavButton
                    active={activeTab === 'convert'}
                    onClick={() => setActiveTab('convert')}
                    icon={<Repeat size={18} />}
                    label="Convertir"
                />
                <NavButton
                    active={activeTab === 'history'}
                    onClick={() => setActiveTab('history')}
                    icon={<History size={18} />}
                    label="Historial"
                />
            </nav>

            {/* ===== MAIN CONTENT PANEL ===== */}
            <div className="panel-shell" style={{ minHeight: '380px' }}>
                <AnimatePresence mode="wait">
                    {activeTab === 'queue' ? (
                        <DownloaderView key="downloader" />
                    ) : activeTab === 'compress' ? (
                        <CompressorView key="compress" />
                    ) : activeTab === 'convert' ? (
                        <ConvertView key="convert" />
                    ) : (
                        <HistoryView key="history" />
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

function NavButton({ active, onClick, icon, label }: any) {
    return (
        <button
            onClick={onClick}
            className={`nav-pill ${active ? 'active' : ''}`}
        >
            {icon}
            <span>{label}</span>
        </button>
    );
}

function DownloaderView() {
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
        addToHistory
    } = useAppStore();

    const [isDownloading, setIsDownloading] = useState(false);

    const getAbsolutePath = (filename: string) => {
        if (!filename) return '';
        if (filename.startsWith('~')) return filename;
        if (filename.includes(':\\') || filename.startsWith('/')) return filename;
        const normFn = filename.replace(/[\\/]+/g, '/').toLowerCase();
        const normDp = downloadPath.replace(/[\\/]+/g, '/').toLowerCase();
        if (normFn.includes(normDp)) return filename;
        const separator = downloadPath.includes('\\') ? '\\' : '/';
        return `${downloadPath}${separator}${filename}`;
    };

    const handleFetch = async () => {
        if (!url.trim() || urlValid === false || loadingInfo) return;
        setLoadingInfo(true);
        setVideoInfo(null);
        try {
            const info = await fetchVideoInfo(url);
            setVideoInfo(info);
        } catch (error) {
            console.error('[FETCH] Failed:', error);
        } finally {
            setLoadingInfo(false);
        }
    };

    const handleDownload = async () => {
        if (isDownloading || !videoInfo) return;
        setIsDownloading(true);
        const outputFormat = formatType === 'video' ? videoFormat : audioFormat;
        const taskTitle = videoInfo.title;
        const taskThumbnail = videoInfo.thumbnail || '';
        const detectedPlatform = videoInfo.platform || 'other';
        const sourceUrl = url || (videoInfo.id.startsWith('http') ? videoInfo.id : `https://www.youtube.com/watch?v=${videoInfo.id}`);

        try {
            const response = await startDownload(
                sourceUrl,
                formatType,
                quality,
                downloadPath,
                outputFormat,
                formatType === 'audio' ? audioQuality : undefined
            );

            const newTask: DownloadTask = {
                task_id: response.task_id,
                status: 'queued',
                progress: 0,
                speed: '0 B/s',
                eta: 'Iniciando...',
                filename: '',
                filepath: '',
                title: taskTitle,
                thumbnail: taskThumbnail,
                platform: detectedPlatform,
                format_type: formatType,
                quality: quality,
                error: null,
                started_at: new Date(),
                filesize: null,
            };

            addToQueue(newTask);
            setVideoInfo(null);
            setUrl('');

            subscribeToTaskEvents(
                response.task_id,
                (data) => {
                    const fullPath = data.filename ? getAbsolutePath(data.filename) : '';
                    updateTask(response.task_id, {
                        ...data,
                        status: data.status as any,
                        filepath: fullPath,
                        title: data.title || taskTitle
                    });

                    if (data.status === 'completed') {
                        addToHistory({
                            id: data.task_id,
                            title: data.title || taskTitle,
                            thumbnail: taskThumbnail,
                            filename: data.filename.split(/[/\\]/).pop() || 'unknown',
                            filepath: fullPath,
                            platform: detectedPlatform,
                            format_type: formatType,
                            format: outputFormat,
                            filesize: 0,
                            completed_at: new Date()
                        });
                    }
                },
                (error) => console.error('[SSE] Error:', error),
                () => console.log('[SSE] Closed')
            );
        } catch (error) {
            console.error('[DOWNLOAD] Failed:', error);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleSelectDirectory = async () => {
        const path = await window.electronAPI?.selectDirectory();
        if (path) setDownloadPath(path);
    };

    const handleOpenFile = (filepath: string) => {
        if (filepath) window.electronAPI?.openPath(filepath);
    };

    const handleOpenFolder = (filepath: string) => {
        if (filepath) window.electronAPI?.showItemInFolder(filepath);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="p-8"
        >
            {/* URL Input Section */}
            <div className="search-group mb-8">
                <div className="relative flex-1 min-w-0">
                    <div className="search-icon">
                        {getPlatformIcon(url, 20)}
                    </div>
                    <input
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
                        placeholder="Pega enlace de YouTube, TikTok, Instagram..."
                        className="search-input"
                        disabled={loadingInfo}
                    />
                </div>
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleFetch}
                    disabled={loadingInfo}
                    className="search-button"
                >
                    {loadingInfo ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
                    <span>Buscar</span>
                </motion.button>
            </div>

            {/* Content Area */}
            <AnimatePresence mode="wait">
                {videoInfo ? (
                    <motion.div
                        key="info"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="result-stack"
                    >
                        <div className="result-surface">
                            {/* Video Preview Card */}
                            <div className="soft-card flex flex-col md:flex-row gap-7 p-7">
                                <div className="w-full md:w-44 shrink-0 aspect-video rounded-xl overflow-hidden shadow-xl">
                                    <img src={resolveThumbnail(videoInfo.thumbnail, videoInfo.platform)} className="w-full h-full object-cover" />
                                </div>
                                <div className="flex-1 min-w-0 py-1">
                                    <h2 className="text-[19px] font-semibold text-white mb-3 line-clamp-2 leading-snug">
                                        {videoInfo.title}
                                    </h2>
                                    <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-400">
                                        <span className="font-medium truncate">{videoInfo.channel}</span>
                                        <span className="text-zinc-600">•</span>
                                        <span className="font-mono">
                                            {(videoInfo.duration || 0) > 0 ? `${Math.floor((videoInfo.duration || 0) / 60)}:${((videoInfo.duration || 0) % 60).toString().padStart(2, '0')}` : '--:--'}
                                        </span>
                                        <div className="tag-pill md:ml-auto flex items-center gap-2 shrink-0">
                                            {getPlatformIcon(videoInfo.platform, 14)}
                                            <span className="uppercase text-xs font-medium text-zinc-300">{videoInfo.platform}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Options Grid */}
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
                                {/* Left Column - Format Options */}
                                <div className="soft-card p-7">
                                    {/* Video/Audio Toggle */}
                                    <div className="segmented-control mb-6">
                                        <button
                                            onClick={() => setFormatType('video')}
                                            className={`segment-item ${formatType === 'video' ? 'active' : ''}`}
                                        >
                                            Video
                                        </button>
                                        <button
                                            onClick={() => setFormatType('audio')}
                                            className={`segment-item ${formatType === 'audio' ? 'active' : ''}`}
                                        >
                                            Audio
                                        </button>
                                    </div>

                                    {formatType === 'video' ? (
                                        <div className="space-y-5">
                                            <div>
                                                <label className="block text-sm text-zinc-400 font-medium mb-2">Calidad</label>
                                                <select
                                                    value={quality}
                                                    onChange={(e) => setQuality(e.target.value)}
                                                    className="w-full h-11 px-4 rounded-lg bg-zinc-900/70 border border-white/10 text-white focus:outline-none focus:border-cyan-400/60"
                                                >
                                                    {VIDEO_QUALITIES.map(q => <option key={q} value={q}>{q === 'best' ? 'Mejor disponible' : `${q}p`}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm text-zinc-400 font-medium mb-2">Formato</label>
                                                <select
                                                    value={videoFormat}
                                                    onChange={(e) => setVideoFormat(e.target.value as any)}
                                                    className="w-full h-11 px-4 rounded-lg bg-zinc-900/70 border border-white/10 text-white focus:outline-none focus:border-cyan-400/60"
                                                >
                                                    {VIDEO_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="space-y-5">
                                            <div>
                                                <label className="block text-sm text-zinc-400 font-medium mb-2">Calidad</label>
                                                <select
                                                    value={audioQuality}
                                                    onChange={(e) => setAudioQuality(e.target.value as any)}
                                                    className="w-full h-11 px-4 rounded-lg bg-zinc-900/70 border border-white/10 text-white focus:outline-none focus:border-cyan-400/60"
                                                >
                                                    {AUDIO_BITRATES.map(b => <option key={b} value={b}>{b} kbps</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-sm text-zinc-400 font-medium mb-2">Formato</label>
                                                <select
                                                    value={audioFormat}
                                                    onChange={(e) => setAudioFormat(e.target.value as any)}
                                                    className="w-full h-11 px-4 rounded-lg bg-zinc-900/70 border border-white/10 text-white focus:outline-none focus:border-cyan-400/60"
                                                >
                                                    {AUDIO_FORMATS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
                                                </select>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Right Column - Destination & Download */}
                                {/* Right Column - Destination & Download */}
                                <div className="flex flex-col gap-6">
                                    <div className="soft-card flex-1 p-7">
                                        <label className="block text-sm text-zinc-400 font-medium mb-4">Guardar en</label>
                                        <button
                                            onClick={handleSelectDirectory}
                                            className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900/60 border border-white/8 hover:border-cyan-400/40 transition-all group"
                                        >
                                            <div className="w-11 h-11 rounded-xl bg-cyan-500/15 flex items-center justify-center group-hover:bg-cyan-500/25 transition-colors shrink-0">
                                                <FolderOpen size={22} className="text-cyan-200" />
                                            </div>
                                            <span className="text-[15px] text-zinc-200 truncate font-medium min-w-0">
                                                {downloadPath.split(/[/\\]/).pop()}
                                            </span>
                                        </button>
                                    </div>

                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={handleDownload}
                                        disabled={isDownloading}
                                        className="download-button"
                                    >
                                        <Download size={24} />
                                        <span>{isDownloading ? 'PROCESANDO...' : 'DESCARGAR'}</span>
                                    </motion.button>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                ) : (
                    <motion.div
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="empty-state"
                    >
                        <div className="empty-icon">
                            <Link size={30} className="text-cyan-200" />
                        </div>
                        <p className="empty-title">Pega un enlace para comenzar</p>
                        <p className="empty-subtitle">YouTube, TikTok, Instagram, Twitter y más</p>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Active Downloads */}
            {downloadQueue.length > 0 && (
                <div className="mt-10 pt-8 border-t border-white/5">
                    <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-5">
                        Descargas Activas
                    </h4>
                    <div className="space-y-4">
                        <AnimatePresence mode="popLayout">
                            {downloadQueue.map(task => (
                                <DownloadItem
                                    key={task.task_id}
                                    task={task}
                                    onOpenFile={() => handleOpenFile(task.filepath)}
                                    onOpenFolder={() => handleOpenFolder(task.filepath)}
                                    onRemove={() => removeFromQueue(task.task_id)}
                                />
                            ))}
                        </AnimatePresence>
                    </div>
                </div>
            )}
        </motion.div>
    );
}

function CompressorView() {
    const {
        downloadPath,
        compressionPreset,
        setCompressionPreset,
        compressionFormat,
        setCompressionFormat,
        compressionUseGpu,
        setCompressionUseGpu,
        compressionOutputDir,
        setCompressionOutputDir,
    } = useAppStore();
    const [inputPath, setInputPath] = useState('');
    const [inputSize, setInputSize] = useState<number | null>(null);
    const [outputFormat, setOutputFormat] = useState<typeof COMPRESS_FORMATS[number]>(compressionFormat || 'mp4');
    const [preset, setPreset] = useState<'high' | 'balanced' | 'light'>(compressionPreset || 'high');
    const [task, setTask] = useState<{ progress: number; status: string; output_path: string; error?: string | null } | null>(null);
    const [isCompressing, setIsCompressing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const dragCounterRef = useRef(0);
    const [gpuEnabled, setGpuEnabled] = useState(compressionUseGpu || false);
    const [encoderInfo, setEncoderInfo] = useState<{ available: boolean; best: string | null } | null>(null);
    const lastEventRef = useRef<number>(0);
    const pollRef = useRef<number | null>(null);
    const dropHandledRef = useRef(false);
    const [dropWarning, setDropWarning] = useState<string | null>(null);

    const presetOptions = [
        { id: 'high', label: 'Alta', description: 'Mejor calidad, menos compresion' },
        { id: 'balanced', label: 'Balanceada', description: 'Buena calidad y menor peso' },
        { id: 'light', label: 'Ligera', description: 'Maximo ahorro, buena nitidez' },
    ] as const;

    const presetIndex = presetOptions.findIndex((option) => option.id === preset);
    const outputDir = compressionOutputDir || downloadPath;

    const getFileName = (value: string) => {
        if (!value) return 'Selecciona un video';
        const parts = value.split(/[/\\]/);
        return parts[parts.length - 1];
    };

    const handleSelectFile = async () => {
        const file = await window.electronAPI?.selectFile?.('video');
        if (file) {
            setInputPath(file);
            setTask(null);
        }
    };

    const resolveDropPath = (event: DragEvent) => {
        let filePath = '';
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            filePath = (file as unknown as { path?: string })?.path || '';
        }

        if (!filePath && event.dataTransfer?.items?.length) {
            const item = event.dataTransfer.items[0];
            const itemFile = item.getAsFile?.();
            filePath = (itemFile as unknown as { path?: string })?.path || '';
        }

        if (!filePath) {
            const uriList = event.dataTransfer?.getData('text/uri-list') || '';
            const first = uriList
                .split(/\r?\n/)
                .map((line) => line.trim())
                .find((line) => line && !line.startsWith('#'));
            if (first && first.startsWith('file://')) {
                let decoded = decodeURIComponent(first.replace('file://', ''));
                if (decoded.startsWith('///')) decoded = decoded.slice(2);
                if (decoded.startsWith('/') && /^[A-Za-z]:/.test(decoded.slice(1))) {
                    decoded = decoded.slice(1);
                }
                filePath = decoded;
            }
        }

        return filePath;
    };

    const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        setIsDragging(false);

        const file = event.dataTransfer.files?.[0];
        if (!file) return;
        const filePath = (file as unknown as { path?: string }).path;
        if (!filePath) return;

        const lower = filePath.toLowerCase();
        if (!lower.match(/\.(mp4|mkv|webm|avi|mov)$/)) return;
        setInputPath(filePath);
        setTask(null);
    };

    const handleSelectOutput = async () => {
        const dir = await window.electronAPI?.selectDirectory?.();
        if (dir) {
            setCompressionOutputDir(dir);
        }
    };

    const handleCompress = async () => {
        if (!inputPath || isCompressing) return;
        setIsCompressing(true);
        setTask({ progress: 0, status: 'starting', output_path: '' });
        lastEventRef.current = Date.now();

        try {
            const response = await startCompression(inputPath, outputDir, outputFormat, preset, gpuEnabled);
            if (pollRef.current) {
                window.clearInterval(pollRef.current);
            }
            pollRef.current = window.setInterval(async () => {
                try {
                    if (Date.now() - lastEventRef.current < 1500) return;
                    const status = await fetchCompressionStatus(response.task_id);
                    setTask(status);
                } catch {
                    // ignore
                }
            }, 1200);
            subscribeToCompressionEvents(
                response.task_id,
                (data) => {
                    lastEventRef.current = Date.now();
                    setTask(data);
                },
                (error) => {
                    console.error('[COMPRESS] Failed:', error);
                    setTask({ progress: 0, status: 'error', output_path: '', error: error.message });
                    setIsCompressing(false);
                    if (pollRef.current) window.clearInterval(pollRef.current);
                },
                () => {
                    setIsCompressing(false);
                    if (pollRef.current) window.clearInterval(pollRef.current);
                }
            );
        } catch (error) {
            console.error('[COMPRESS] Start failed:', error);
            setTask({ progress: 0, status: 'error', output_path: '', error: (error as Error).message });
            setIsCompressing(false);
            if (pollRef.current) window.clearInterval(pollRef.current);
        }
    };

    useEffect(() => {
        let active = true;
        fetchCompressionEncoders()
            .then((data) => {
                if (!active) return;
                setEncoderInfo({ available: data.available, best: data.best });
            })
            .catch(() => {
                if (!active) return;
                setEncoderInfo({ available: false, best: null });
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        window.electronAPI?.onFileDrop?.(async (filePath) => {
            if (dropHandledRef.current) return;
            dropHandledRef.current = true;

            setIsDragging(false);
            dragCounterRef.current = 0;

            const resolvedPath = filePath || '';
            if (!resolvedPath) {
                setDropWarning('No se pudo leer el archivo. Usa clic para seleccionar.');
                dropHandledRef.current = false;
                return;
            }
            const lower = resolvedPath.toLowerCase();
            if (!lower.match(/\.(mp4|mkv|webm|avi|mov)$/)) {
                setDropWarning('Formato no soportado. Usa MP4, MKV o WEBM.');
                dropHandledRef.current = false;
                return;
            }
            setDropWarning(null);
            setInputPath(resolvedPath);
            setTask(null);
            setTimeout(() => {
                dropHandledRef.current = false;
            }, 300);
        });

        const clearOverlay = () => {
            setIsDragging(false);
            dragCounterRef.current = 0;
        };

        const handleDropCapture = (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            clearOverlay();

            if (dropHandledRef.current) return;
            dropHandledRef.current = true;

            const filePath = resolveDropPath(event);

            if (filePath) {
                setDropWarning(null);
                setInputPath(filePath);
                setTask(null);
            } else {
                setDropWarning('No se pudo leer el archivo. Usa clic para seleccionar.');
            }

            setTimeout(() => {
                dropHandledRef.current = false;
            }, 300);
        };

        document.addEventListener('drop', handleDropCapture, { capture: true, passive: false });
        window.addEventListener('dragend', clearOverlay);

        return () => {
            document.removeEventListener('drop', handleDropCapture, true as unknown as EventListenerOptions);
            window.removeEventListener('dragend', clearOverlay);
        };
    }, []);

    useEffect(() => {
        if (!inputPath) {
            setInputSize(null);
            return;
        }

        window.electronAPI?.statFile?.(inputPath).then((result) => {
            if (result?.size) {
                setInputSize(result.size);
            }
        });
    }, [inputPath]);

    useEffect(() => {
        if (!isCompressing) {
            setPreset(compressionPreset);
            setOutputFormat(compressionFormat);
            setGpuEnabled(compressionUseGpu);
        }
    }, [compressionPreset, compressionFormat, compressionUseGpu, isCompressing]);

    const formatBytes = (bytes: number) => {
        if (bytes <= 0) return '0 MB';
        const mb = bytes / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    };

    const estimateSize = () => {
        if (!inputSize) return null;
        const ratioMap = {
            high: 0.75,
            balanced: 0.55,
            light: 0.35,
        } as const;
        const ratio = ratioMap[preset] ?? 0.6;
        return Math.max(5 * 1024 * 1024, inputSize * ratio);
    };

    useEffect(() => {
        const preventDefaults = (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
        };

        const handleWindowDrop = (event: DragEvent) => {
            preventDefaults(event);
            dragCounterRef.current = 0;
            setIsDragging(false);

            let filePath = '';
            const file = event.dataTransfer?.files?.[0];
            if (file) {
                filePath = (file as unknown as { path?: string }).path || '';
            }

            if (!filePath && event.dataTransfer?.items?.length) {
                const item = event.dataTransfer.items[0];
                const fileFromItem = item.getAsFile?.();
                filePath = (fileFromItem as unknown as { path?: string })?.path || '';
            }

            if (!filePath) return;
            const lower = filePath.toLowerCase();
            if (!lower.match(/\.(mp4|mkv|webm|avi|mov)$/)) return;
            setInputPath(filePath);
            setTask(null);
        };

        const handleWindowDragOver = (event: DragEvent) => {
            preventDefaults(event);
            event.dataTransfer?.dropEffect && (event.dataTransfer.dropEffect = 'copy');
        };

        const handleWindowDragEnter = (event: DragEvent) => {
            preventDefaults(event);
            dragCounterRef.current += 1;
            setIsDragging(true);
        };

        const handleWindowDragLeave = (event: DragEvent) => {
            preventDefaults(event);
            dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
            if (dragCounterRef.current === 0) setIsDragging(false);
        };

        const handleWindowDragEnd = (event: DragEvent) => {
            preventDefaults(event);
            dragCounterRef.current = 0;
            setIsDragging(false);
        };

        const body = document.body;

        window.addEventListener('dragover', handleWindowDragOver);
        window.addEventListener('drop', handleWindowDrop);
        window.addEventListener('dragenter', handleWindowDragEnter);
        window.addEventListener('dragleave', handleWindowDragLeave);
        window.addEventListener('dragend', handleWindowDragEnd);

        if (body) {
            body.addEventListener('dragover', handleWindowDragOver, true);
            body.addEventListener('drop', handleWindowDrop, true);
            body.addEventListener('dragenter', handleWindowDragEnter, true);
            body.addEventListener('dragleave', handleWindowDragLeave, true);
        }

        return () => {
            window.removeEventListener('dragover', handleWindowDragOver);
            window.removeEventListener('drop', handleWindowDrop);
            window.removeEventListener('dragenter', handleWindowDragEnter);
            window.removeEventListener('dragleave', handleWindowDragLeave);
            window.removeEventListener('dragend', handleWindowDragEnd);

            if (body) {
                body.removeEventListener('dragover', handleWindowDragOver, true);
                body.removeEventListener('drop', handleWindowDrop, true);
                body.removeEventListener('dragenter', handleWindowDragEnter, true);
                body.removeEventListener('dragleave', handleWindowDragLeave, true);
            }
        };
    }, []);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="p-8"
        >
            <div className="compress-shell">
                {isDragging && (
                    <div
                        className="drop-overlay"
                        onDragOver={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onDrop={handleDrop}
                    >
                        <div className="drop-overlay-inner">
                            <span>Suelta el video para cargarlo</span>
                        </div>
                    </div>
                )}
                <div className="compress-grid">
                    <div className="compress-card">
                        <div className="compress-header">
                            <h3>Archivo de origen</h3>
                            <p>Selecciona un video local para comprimir.</p>
                        </div>
                        <div
                            className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setIsDragging(true);
                            }}
                            onDragEnter={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setIsDragging(true);
                            }}
                            onDragLeave={() => setIsDragging(false)}
                            onDrop={handleDrop}
                        >
                            <button
                                type="button"
                                onClick={handleSelectFile}
                                className="file-picker"
                            >
                                <div className="file-badge">
                                    <Film size={20} className="text-cyan-200" />
                                </div>
                                <div className="file-text">
                                    <span className="file-name">{getFileName(inputPath)}</span>
                                    <span className="file-path">{inputPath || 'MP4, MKV, WEBM, AVI, MOV'}</span>
                                </div>
                                <span className="file-action">{isDragging ? 'Soltar' : 'Elegir'}</span>
                            </button>
                            <div className="drop-hint">Arrastra y suelta un video aqui</div>
                        </div>
                    </div>

                    <div className="compress-card">
                        <div className="compress-header">
                            <h3>Calidad de compresion</h3>
                            <p>Ajusta el balance entre peso y calidad.</p>
                        </div>
                        <div className="range-wrap">
                            <input
                                type="range"
                                min={0}
                                max={2}
                                step={1}
                                value={Math.max(presetIndex, 0)}
                                onChange={(event) => {
                                    const index = Number(event.target.value);
                                    setPreset(presetOptions[index].id);
                                    setCompressionPreset(presetOptions[index].id);
                                }}
                                className="range-input"
                                disabled={isCompressing}
                            />
                            <div className="range-labels">
                                {presetOptions.map((option) => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        onClick={() => {
                                            setPreset(option.id);
                                            setCompressionPreset(option.id);
                                        }}
                                        className={`range-pill ${preset === option.id ? 'active' : ''}`}
                                        disabled={isCompressing}
                                    >
                                        <span>{option.label}</span>
                                        <small>{option.description}</small>
                                    </button>
                                ))}
                            </div>
                            {dropWarning && (
                                <div className="compress-warning">
                                    {dropWarning}
                                </div>
                            )}
                            {inputSize && (
                                <div className="compress-estimate">
                                    <span>Estimado:</span>
                                    <strong>{formatBytes(inputSize)}</strong>
                                    <span>→</span>
                                    <strong>{formatBytes(estimateSize() || 0)}</strong>
                                </div>
                            )}
                            {inputSize && estimateSize() && estimateSize()! >= inputSize && (
                                <div className="compress-warning">
                                    Este archivo ya esta muy comprimido. El resultado puede pesar mas.
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="compress-card span-full">
                        <div className="compress-header">
                            <h3>Salida</h3>
                            <p>Formato y carpeta de exportacion.</p>
                        </div>
                        <div className="compress-row">
                            <div className="compress-field">
                                <label>Formato de salida</label>
                                <div className={`segmented-control ${isCompressing ? 'is-disabled' : ''}`}>
                                    {COMPRESS_FORMATS.map((format) => (
                                        <button
                                            key={format}
                                            onClick={() => {
                                                setOutputFormat(format);
                                                setCompressionFormat(format);
                                            }}
                                            className={`segment-item ${outputFormat === format ? 'active' : ''}`}
                                            disabled={isCompressing}
                                        >
                                            {format.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="compress-field">
                                <label>Modo rapido (GPU)</label>
                                <button
                                    type="button"
                                    className={`gpu-toggle ${gpuEnabled ? 'active' : ''} ${encoderInfo?.available ? '' : 'disabled'}`}
                                    onClick={() => {
                                        if (!encoderInfo?.available) return;
                                        setGpuEnabled((prev) => {
                                            const next = !prev;
                                            setCompressionUseGpu(next);
                                            return next;
                                        });
                                    }}
                                    disabled={isCompressing}
                                >
                                    <span>{gpuEnabled ? 'Activado' : 'Desactivado'}</span>
                                    <small>
                                        {encoderInfo?.available
                                            ? `Encoder: ${encoderInfo.best || 'auto'}`
                                            : 'No se detecto GPU compatible'}
                                    </small>
                                </button>
                            </div>
                            <div className="compress-field">
                                <label>Guardar en</label>
                                <button onClick={handleSelectOutput} className="file-picker is-compact">
                                    <div className="file-badge">
                                        <FolderOpen size={18} className="text-cyan-200" />
                                    </div>
                                    <div className="file-text">
                                        <span className="file-name">{getFileName(outputDir)}</span>
                                        <span className="file-path">{outputDir}</span>
                                    </div>
                                    <span className="file-action">Cambiar</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="compress-footer">
                    <div className="compress-status">
                        {task?.status === 'error' ? (
                            <span className="status-error">{task.error || 'Error al comprimir'}</span>
                        ) : task?.status === 'completed' ? (
                            <span className="status-success">Listo. Archivo comprimido.</span>
                        ) : (
                            <span className="status-muted">{isCompressing ? 'Comprimiendo...' : 'Listo para comprimir.'}</span>
                        )}
                    </div>
                    <div className="compress-actions">
                        {task?.output_path && task.status === 'completed' && (
                            <button
                                onClick={() => window.electronAPI?.showItemInFolder?.(task.output_path)}
                                className="history-action is-folder"
                            >
                                <FolderOpen size={18} />
                            </button>
                        )}
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={handleCompress}
                            disabled={!inputPath || isCompressing}
                            className="compress-button"
                        >
                            <SlidersHorizontal size={18} />
                            <span>{isCompressing ? 'COMPRIMIENDO...' : 'COMPRIMIR'}</span>
                        </motion.button>
                    </div>
                </div>

                {task && (
                    <div className="compress-progress">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${task.progress || 0}%` }} />
                        </div>
                        <div className="progress-meta">
                            <span>{Math.round(task.progress || 0)}%</span>
                            <span>{task.status}</span>
                        </div>
                    </div>
                )}

                {filteredHistory.length > 0 && (
                    <div className="mt-8">
                        <h4 className="text-sm font-semibold text-zinc-400 uppercase tracking-widest mb-5">
                            Conversiones recientes
                        </h4>
                        <div className="history-list">
                            <AnimatePresence mode="popLayout">
                                {filteredHistory.map((entry) => (
                                    <motion.div
                                        key={entry.id}
                                        layout
                                        initial={{ opacity: 0, y: 8 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, x: -20 }}
                                        className="list-item"
                                    >
                                        <div className="list-thumb w-20 aspect-video rounded-xl overflow-hidden shrink-0 flex items-center justify-center">
                                            {getMediaIcon(entry.media_type)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-[15px] font-medium text-zinc-200 truncate mb-1">{entry.title}</h4>
                                            <div className="flex items-center gap-3 text-sm text-zinc-500">
                                                <span className="tag-chip">{entry.format.toUpperCase()}</span>
                                                <span className="text-zinc-600">•</span>
                                                <span>{new Date(entry.completed_at).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleOpenFile(entry.output_path)} className="history-action is-play">
                                                <Play size={18} />
                                            </button>
                                            <button onClick={() => handleOpenFolder(entry.output_path)} className="history-action is-folder">
                                                <FolderOpen size={18} />
                                            </button>
                                            <button onClick={() => removeConvertHistory(entry.id)} className="history-action is-remove">
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </motion.div>
                                ))}
                            </AnimatePresence>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function ConvertView() {
    const convertTab = useAppStore((state) => state.convertTab);
    const setConvertTab = useAppStore((state) => state.setConvertTab);
    const convertVideoFormat = useAppStore((state) => state.convertVideoFormat);
    const setConvertVideoFormat = useAppStore((state) => state.setConvertVideoFormat);
    const convertAudioFormat = useAppStore((state) => state.convertAudioFormat);
    const setConvertAudioFormat = useAppStore((state) => state.setConvertAudioFormat);
    const convertImageFormat = useAppStore((state) => state.convertImageFormat);
    const setConvertImageFormat = useAppStore((state) => state.setConvertImageFormat);
    const convertVideoQuality = useAppStore((state) => state.convertVideoQuality);
    const setConvertVideoQuality = useAppStore((state) => state.setConvertVideoQuality);
    const convertAudioQuality = useAppStore((state) => state.convertAudioQuality);
    const setConvertAudioQuality = useAppStore((state) => state.setConvertAudioQuality);
    const convertImageQuality = useAppStore((state) => state.convertImageQuality);
    const setConvertImageQuality = useAppStore((state) => state.setConvertImageQuality);
    const convertOutputDir = useAppStore((state) => state.convertOutputDir);
    const setConvertOutputDir = useAppStore((state) => state.setConvertOutputDir);
    const convertHistory = useAppStore((state) => state.convertHistory);
    const addConvertHistory = useAppStore((state) => state.addConvertHistory);
    const removeConvertHistory = useAppStore((state) => state.removeConvertHistory);
    const [videoInput, setVideoInput] = useState('');
    const [audioInput, setAudioInput] = useState('');
    const [imageInput, setImageInput] = useState('');
    const [task, setTask] = useState<{ progress: number; status: string; output_path: string; error?: string | null } | null>(null);
    const [isConverting, setIsConverting] = useState(false);
    const completedConvertIds = useRef(new Set<string>());
    const [videoInfo, setVideoInfo] = useState<{ duration: number | null; size: number | null; bit_rate: number | null } | null>(null);
    const [audioInfo, setAudioInfo] = useState<{ duration: number | null; size: number | null; bit_rate: number | null } | null>(null);
    const [imageInfo, setImageInfo] = useState<{ duration: number | null; size: number | null; bit_rate: number | null } | null>(null);

    const getFileName = (value: string) => {
        if (!value) return 'Selecciona un archivo';
        const parts = value.split(/[/\\]/);
        return parts[parts.length - 1];
    };

    const getDirName = (value: string) => {
        if (!value) return '';
        const parts = value.split(/[/\\]/);
        parts.pop();
        return parts.join('\\') || '';
    };

    const formatBytes = (bytes: number) => {
        if (bytes <= 0) return '0 MB';
        const mb = bytes / (1024 * 1024);
        if (mb < 1024) return `${mb.toFixed(1)} MB`;
        return `${(mb / 1024).toFixed(2)} GB`;
    };

    const getMediaIcon = (type: 'video' | 'audio' | 'image') => {
        if (type === 'audio') return <Music size={20} className="text-cyan-200" />;
        if (type === 'image') return <Image size={20} className="text-cyan-200" />;
        return <Film size={20} className="text-cyan-200" />;
    };

    const handleOpenFile = (filepath: string) => {
        if (filepath) window.electronAPI?.openPath(filepath);
    };

    const handleOpenFolder = (filepath: string) => {
        if (filepath) window.electronAPI?.showItemInFolder(filepath);
    };

    const estimateVideoSize = () => {
        if (!videoInfo?.size) return null;
        const ratioMap = { high: 0.9, balanced: 0.7, light: 0.55 } as const;
        const ratio = ratioMap[convertVideoQuality] ?? 0.7;
        if (videoInfo.duration && videoInfo.bit_rate) {
            const outRate = videoInfo.bit_rate * ratio;
            return (videoInfo.duration * outRate) / 8;
        }
        return videoInfo.size * ratio;
    };

    const estimateAudioSize = () => {
        if (!audioInfo?.size) return null;
        if (audioInfo.duration) {
            const kbps = Number(convertAudioQuality);
            return (audioInfo.duration * kbps * 1000) / 8;
        }
        const ratioMap = { high: 0.9, balanced: 0.7, light: 0.55 } as const;
        return audioInfo.size * (ratioMap.balanced || 0.7);
    };

    const estimateImageSize = () => {
        if (!imageInfo?.size) return null;
        const ratioMap = { high: 0.85, balanced: 0.7, light: 0.5 } as const;
        return imageInfo.size * (ratioMap[convertImageQuality] ?? 0.7);
    };

    const handleSelect = async (kind: 'video' | 'audio' | 'media' | 'image', setter: (path: string) => void, infoSetter: (info: any) => void) => {
        const file = await window.electronAPI?.selectFile?.(kind);
        if (file) {
            setter(file);
            setConvertOutputDir(getDirName(file));
            setTask(null);
            try {
                const info = await fetchLocalInfo(file);
                infoSetter(info);
            } catch {
                infoSetter(null);
            }
        }
    };

    const handleSelectOutput = async () => {
        const dir = await window.electronAPI?.selectDirectory?.();
        if (dir) {
            setConvertOutputDir(dir);
        }
    };

    const handleConvert = async (type: 'video' | 'audio' | 'image') => {
        if (isConverting) return;
        const inputPath = type === 'video' ? videoInput : type === 'audio' ? audioInput : imageInput;
        if (!inputPath) return;

        const format = type === 'video' ? convertVideoFormat : type === 'audio' ? convertAudioFormat : convertImageFormat;
        const quality = type === 'video'
            ? convertVideoQuality
            : type === 'audio'
                ? convertAudioQuality
                : convertImageQuality;

        setIsConverting(true);
        setTask({ progress: 0, status: 'starting', output_path: '' });

        try {
            const response = await startConvert(
                inputPath,
                convertOutputDir || getDirName(inputPath),
                format,
                type,
                quality
            );
            subscribeToConvertEvents(
                response.task_id,
                (data) => {
                    setTask(data);
                    if (data.status === 'completed' && !completedConvertIds.current.has(response.task_id)) {
                        completedConvertIds.current.add(response.task_id);
                        const outputPath = data.output_path || '';
                        const title = getFileName(outputPath || inputPath);
                        addConvertHistory({
                            id: response.task_id,
                            title,
                            input_path: inputPath,
                            output_path: outputPath,
                            format,
                            media_type: type,
                            completed_at: new Date(),
                        });
                        setTask(null);
                    }
                },
                (error) => {
                    console.error('[CONVERT] Failed:', error);
                    setTask({ progress: 0, status: 'error', output_path: '', error: error.message });
                    setIsConverting(false);
                },
                () => setIsConverting(false)
            );
        } catch (error) {
            console.error('[CONVERT] Start failed:', error);
            setTask({ progress: 0, status: 'error', output_path: '', error: (error as Error).message });
            setIsConverting(false);
        }
    };

    const filteredHistory = convertHistory.filter((entry) => entry.media_type === convertTab);

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="p-8"
        >
            <div className="convert-shell">
                <div className="convert-tabs">
                    <button
                        onClick={() => setConvertTab('video')}
                        className={`convert-tab ${convertTab === 'video' ? 'active' : ''}`}
                    >
                        Videos
                    </button>
                    <button
                        onClick={() => setConvertTab('audio')}
                        className={`convert-tab ${convertTab === 'audio' ? 'active' : ''}`}
                    >
                        Audios
                    </button>
                    <button
                        onClick={() => setConvertTab('image')}
                        className={`convert-tab ${convertTab === 'image' ? 'active' : ''}`}
                    >
                        Imagenes
                    </button>
                </div>

                {convertTab === 'video' && (
                    <div className="convert-card">
                        <div className="compress-header">
                            <h3>Videos</h3>
                            <p>Convierte mp4, mkv, webm, mov, avi o m4v.</p>
                        </div>
                        <button onClick={() => handleSelect('video', setVideoInput, setVideoInfo)} className="file-picker">
                            <div className="file-badge">
                                <Film size={20} className="text-cyan-200" />
                            </div>
                            <div className="file-text">
                                <span className="file-name">{getFileName(videoInput)}</span>
                                <span className="file-path">{videoInput || 'MP4, MKV, WEBM, MOV, AVI, M4V'}</span>
                            </div>
                            <span className="file-action">Elegir</span>
                        </button>
                        <div className="convert-row">
                            <div className="compress-field">
                                <label>Formato de salida</label>
                                <div className="segmented-control">
                                    {CONVERT_VIDEO_FORMATS.map((format) => (
                                        <button
                                            key={format}
                                            onClick={() => setConvertVideoFormat(format)}
                                            className={`segment-item ${convertVideoFormat === format ? 'active' : ''}`}
                                        >
                                            {format.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="compress-field">
                                <label>Calidad</label>
                                <div className="segmented-control">
                                    {['high', 'balanced', 'light'].map((option) => (
                                        <button
                                            key={option}
                                            onClick={() => setConvertVideoQuality(option as 'high' | 'balanced' | 'light')}
                                            className={`segment-item ${convertVideoQuality === option ? 'active' : ''}`}
                                        >
                                            {option === 'high' ? 'Alta' : option === 'balanced' ? 'Balanceada' : 'Ligera'}
                                        </button>
                                    ))}
                                </div>
                                {videoInfo?.size && estimateVideoSize() && (
                                    <div className="compress-estimate">
                                        <span>Estimado:</span>
                                        <strong>{formatBytes(videoInfo.size)}</strong>
                                        <span>→</span>
                                        <strong>{formatBytes(estimateVideoSize() || 0)}</strong>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="convert-actions">
                            <button onClick={handleSelectOutput} className="history-action is-folder">
                                <FolderOpen size={18} />
                            </button>
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => handleConvert('video')}
                                disabled={!videoInput || isConverting}
                                className="compress-button"
                            >
                                <Repeat size={18} />
                                <span>CONVERTIR</span>
                            </motion.button>
                        </div>
                    </div>
                )}

                {convertTab === 'audio' && (
                    <div className="convert-card">
                        <div className="compress-header">
                            <h3>Audios</h3>
                            <p>Extrae audio de videos y convierte mp3, aac, wav, flac, ogg, opus o m4a.</p>
                        </div>
                        <button onClick={() => handleSelect('media', setAudioInput, setAudioInfo)} className="file-picker">
                            <div className="file-badge">
                                <Music size={20} className="text-cyan-200" />
                            </div>
                            <div className="file-text">
                                <span className="file-name">{getFileName(audioInput)}</span>
                                <span className="file-path">{audioInput || 'MP4, MKV, WEBM, MOV, AVI, M4V, MP3, AAC, WAV, FLAC, OGG, OPUS, M4A'}</span>
                            </div>
                            <span className="file-action">Elegir</span>
                        </button>
                        <div className="convert-row">
                            <div className="compress-field">
                                <label>Formato de salida</label>
                                <div className="segmented-control">
                                    {CONVERT_AUDIO_FORMATS.map((format) => (
                                        <button
                                            key={format}
                                            onClick={() => setConvertAudioFormat(format)}
                                            className={`segment-item ${convertAudioFormat === format ? 'active' : ''}`}
                                        >
                                            {format.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="compress-field">
                                <label>Calidad</label>
                                <div className="segmented-control">
                                    {AUDIO_BITRATES.map((bitrate) => (
                                        <button
                                            key={bitrate}
                                            onClick={() => setConvertAudioQuality(bitrate)}
                                            className={`segment-item ${convertAudioQuality === bitrate ? 'active' : ''}`}
                                        >
                                            {bitrate} kbps
                                        </button>
                                    ))}
                                </div>
                                {audioInfo?.size && estimateAudioSize() && (
                                    <div className="compress-estimate">
                                        <span>Estimado:</span>
                                        <strong>{formatBytes(audioInfo.size)}</strong>
                                        <span>→</span>
                                        <strong>{formatBytes(estimateAudioSize() || 0)}</strong>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="convert-actions">
                            <button onClick={handleSelectOutput} className="history-action is-folder">
                                <FolderOpen size={18} />
                            </button>
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => handleConvert('audio')}
                                disabled={!audioInput || isConverting}
                                className="compress-button"
                            >
                                <Repeat size={18} />
                                <span>CONVERTIR</span>
                            </motion.button>
                        </div>
                    </div>
                )}

                {convertTab === 'image' && (
                    <div className="convert-card">
                        <div className="compress-header">
                            <h3>Imagenes</h3>
                            <p>Convierte png, jpg, webp, bmp o tiff.</p>
                        </div>
                        <button onClick={() => handleSelect('image', setImageInput, setImageInfo)} className="file-picker">
                            <div className="file-badge">
                                <Film size={20} className="text-cyan-200" />
                            </div>
                            <div className="file-text">
                                <span className="file-name">{getFileName(imageInput)}</span>
                                <span className="file-path">{imageInput || 'PNG, JPG, WEBP, BMP, TIFF'}</span>
                            </div>
                            <span className="file-action">Elegir</span>
                        </button>
                        <div className="convert-row">
                            <div className="compress-field">
                                <label>Formato de salida</label>
                                <div className="segmented-control">
                                    {CONVERT_IMAGE_FORMATS.map((format) => (
                                        <button
                                            key={format}
                                            onClick={() => setConvertImageFormat(format)}
                                            className={`segment-item ${convertImageFormat === format ? 'active' : ''}`}
                                        >
                                            {format.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="compress-field">
                                <label>Calidad</label>
                                <div className="segmented-control">
                                    {['high', 'balanced', 'light'].map((option) => (
                                        <button
                                            key={option}
                                            onClick={() => setConvertImageQuality(option as 'high' | 'balanced' | 'light')}
                                            className={`segment-item ${convertImageQuality === option ? 'active' : ''}`}
                                        >
                                            {option === 'high' ? 'Alta' : option === 'balanced' ? 'Balanceada' : 'Ligera'}
                                        </button>
                                    ))}
                                </div>
                                {imageInfo?.size && estimateImageSize() && (
                                    <div className="compress-estimate">
                                        <span>Estimado:</span>
                                        <strong>{formatBytes(imageInfo.size)}</strong>
                                        <span>→</span>
                                        <strong>{formatBytes(estimateImageSize() || 0)}</strong>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="convert-actions">
                            <button onClick={handleSelectOutput} className="history-action is-folder">
                                <FolderOpen size={18} />
                            </button>
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => handleConvert('image')}
                                disabled={!imageInput || isConverting}
                                className="compress-button"
                            >
                                <Repeat size={18} />
                                <span>CONVERTIR</span>
                            </motion.button>
                        </div>
                    </div>
                )}

                {task && (
                    <div className="compress-progress">
                        <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${task.progress || 0}%` }} />
                        </div>
                        <div className="progress-meta">
                            <span>{Math.round(task.progress || 0)}%</span>
                            <span>{task.status}</span>
                        </div>
                    </div>
                )}
            </div>
        </motion.div>
    );
}

function HistoryView() {
    const { videoHistory, audioHistory, clearHistory, removeFromHistory } = useAppStore();
    const [filter, setFilter] = useState<'video' | 'audio'>('video');
    const list = filter === 'video' ? videoHistory : audioHistory;

    const handleOpenFile = (filepath: string) => {
        if (filepath) window.electronAPI?.openPath(filepath);
    };

    const handleOpenFolder = (filepath: string) => {
        if (filepath) window.electronAPI?.showItemInFolder(filepath);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="p-8"
        >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div className="segmented-control">
                    <button
                        onClick={() => setFilter('video')}
                        className={`segment-item ${filter === 'video' ? 'active' : ''}`}
                    >
                        <MonitorPlay size={18} />
                        <span>Videos</span>
                        <span className="ml-1 px-2 py-0.5 rounded-md text-xs bg-zinc-600/50">{videoHistory.length}</span>
                    </button>
                    <button
                        onClick={() => setFilter('audio')}
                        className={`segment-item ${filter === 'audio' ? 'active' : ''}`}
                    >
                        <Headphones size={18} />
                        <span>Audios</span>
                        <span className="ml-1 px-2 py-0.5 rounded-md text-xs bg-zinc-600/50">{audioHistory.length}</span>
                    </button>
                </div>
                {list.length > 0 && (
                    <button
                        onClick={clearHistory}
                        className="history-clear"
                    >
                        <Trash2 size={16} />
                        Borrar Historial
                    </button>
                )}
            </div>

            {/* List */}
            <div className="history-list">
                {list.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <History size={30} className="text-cyan-200" />
                        </div>
                        <p className="empty-title">No hay historial de {filter}s</p>
                    </div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        {list.map(item => (
                            <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="list-item"
                            >
                                <div className="list-thumb w-20 aspect-video rounded-xl overflow-hidden bg-black/40 shrink-0">
                                    {item.thumbnail ? (
                                        <img src={resolveThumbnail(item.thumbnail, item.platform)} className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center">
                                            {filter === 'video' ? <Film size={20} className="text-zinc-600" /> : <Music size={20} className="text-zinc-600" />}
                                        </div>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h4 className="text-[15px] font-medium text-zinc-200 truncate mb-1">{item.title}</h4>
                                    <div className="flex items-center gap-3 text-sm text-zinc-500">
                                        <span className="tag-chip">{item.format}</span>
                                        <span className="text-zinc-600">•</span>
                                        <span>{new Date(item.completed_at).toLocaleDateString()}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleOpenFile(item.filepath)} className="history-action is-play">
                                        <Play size={18} />
                                    </button>
                                    <button onClick={() => handleOpenFolder(item.filepath)} className="history-action is-folder">
                                        <FolderOpen size={18} />
                                    </button>
                                    <button onClick={() => removeFromHistory(item.id)} className="history-action is-remove">
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </motion.div>
    );
}

function DownloadItem({ task, onOpenFile, onOpenFolder, onRemove }: any) {
    const isCompleted = task.status === 'completed';
    const isError = task.status === 'error';

    return (
        <motion.div
            layout
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="list-item relative overflow-hidden"
        >
            {task.status === 'downloading' && (
                <div
                    className="absolute left-0 top-0 bottom-0 bg-violet-600/10 transition-all duration-300"
                    style={{ width: `${task.progress}%` }}
                />
            )}

            <div className="list-thumb relative z-10 w-12 h-12 rounded-xl bg-black/40 shrink-0 overflow-hidden flex items-center justify-center">
                {task.thumbnail ? <img src={resolveThumbnail(task.thumbnail, task.platform)} className="w-full h-full object-cover" /> : <Film size={24} className="text-zinc-600" />}
            </div>

            <div className="relative z-10 flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                    {task.platform && getPlatformIcon(task.platform, 16)}
                    <h4 className="text-[15px] font-medium text-white truncate">{task.title || 'Cargando...'}</h4>
                </div>
                <div className="text-sm text-zinc-400">
                    {task.status === 'downloading' ? (
                        <span>{task.speed} • ETA: {task.eta} • {Math.round(task.progress)}%</span>
                    ) : (
                        <span className={isCompleted ? 'text-green-400' : isError ? 'text-red-400' : ''}>
                            {isCompleted ? 'Completado' : isError ? (task.error || 'Error') : 'En cola...'}
                        </span>
                    )}
                </div>
            </div>

            <div className="relative z-10 flex items-center gap-2">
                {isCompleted && (
                    <>
                        <button onClick={onOpenFile} className="history-action is-play">
                            <Play size={18} />
                        </button>
                        <button onClick={onOpenFolder} className="history-action is-folder">
                            <FolderOpen size={18} />
                        </button>
                    </>
                )}
                <button onClick={onRemove} className="history-action is-remove">
                    <Trash2 size={18} />
                </button>
            </div>
        </motion.div>
    );
}

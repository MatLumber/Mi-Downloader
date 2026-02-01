import { motion } from 'framer-motion';
import { Film, Music, Download, Folder, ChevronDown } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { startDownload, subscribeToTaskEvents } from '../api/client';
import { useState } from 'react';

const VIDEO_FORMATS = ['mp4', 'mkv', 'webm', 'avi'] as const;
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'opus'] as const;
const VIDEO_QUALITIES = ['best', '1080', '720', '480', '360'] as const;
const AUDIO_BITRATES = ['320', '256', '192', '128'] as const;

export function VideoInfo() {
    const {
        videoInfo,
        formatType, setFormatType,
        quality, setQuality,
        videoFormat, setVideoFormat,
        audioFormat, setAudioFormat,
        audioQuality, setAudioQuality,
        downloadPath, addToQueue, updateTask, addToHistory,
        setVideoInfo, setUrl, apiOnline
    } = useAppStore();

    const [isDownloading, setIsDownloading] = useState(false);

    if (!videoInfo) return null;

    const formatDuration = (seconds: number | null) => {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const formatViews = (views: number | null) => {
        if (!views) return '';
        if (views >= 1000000) return `${(views / 1000000).toFixed(1)}M views`;
        if (views >= 1000) return `${(views / 1000).toFixed(0)}K views`;
        return `${views} views`;
    };

    const handleDownload = async () => {
        if (!apiOnline || isDownloading) return;

        setIsDownloading(true);
        const outputFormat = formatType === 'video' ? videoFormat : audioFormat;
        const taskTitle = videoInfo?.title || '';
        const taskThumbnail = videoInfo?.thumbnail || '';

        try {
            const response = await startDownload(
                videoInfo.id.startsWith('http') ? videoInfo.id : `https://www.youtube.com/watch?v=${videoInfo.id}`,
                formatType,
                quality,
                downloadPath,
                outputFormat,
                formatType === 'audio' ? audioQuality : undefined
            );

            const newTask = {
                task_id: response.task_id,
                status: 'queued' as const,
                progress: 0,
                speed: '0 B/s',
                eta: 'Starting...',
                filename: '',
                filepath: '',
                title: taskTitle,
                thumbnail: taskThumbnail,
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
                    updateTask(response.task_id, {
                        status: data.status as any,
                        progress: data.progress,
                        speed: data.speed,
                        eta: data.eta,
                        filename: data.filename,
                        filepath: data.filename || '',
                        title: data.title || taskTitle,
                        error: data.error,
                    });

                    if (data.status === 'completed') {
                        addToHistory({
                            id: data.task_id,
                            title: data.title || taskTitle,
                            thumbnail: taskThumbnail,
                            filename: data.filename.split(/[/\\]/).pop() || 'unknown',
                            filepath: data.filename,
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
        if (path) {
            useAppStore.getState().setDownloadPath(path);
        }
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="glass-card p-6 flex flex-col gap-6"
        >
            {/* Video Preview & Info */}
            <div className="flex gap-5">
                {/* Thumbnail */}
                <div className="w-48 flex-shrink-0">
                    <div className="video-preview">
                        {videoInfo.thumbnail ? (
                            <img src={videoInfo.thumbnail} alt={videoInfo.title} />
                        ) : (
                            <div className="w-full h-full bg-bg-tertiary flex items-center justify-center">
                                <Film className="w-10 h-10 text-text-muted" />
                            </div>
                        )}
                        <span className="video-duration">{formatDuration(videoInfo.duration)}</span>
                    </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <h2
                        className="text-lg font-semibold text-text-primary mb-2 line-clamp-2"
                        style={{ fontFamily: 'var(--font-display)' }}
                    >
                        {videoInfo.title}
                    </h2>
                    <p className="text-sm text-text-secondary mb-1">{videoInfo.channel}</p>
                    <p className="text-sm text-text-muted">{formatViews(videoInfo.view_count)}</p>

                    {/* Format badges */}
                    <div className="flex items-center gap-2 mt-3">
                        {videoInfo.formats.some(f => f.height >= 2160) && (
                            <span className="badge badge-info">4K</span>
                        )}
                        {videoInfo.formats.some(f => f.height >= 1080) && (
                            <span className="badge badge-info">1080p</span>
                        )}
                        <span className="badge badge-info">{videoInfo.formats.length} formats</span>
                    </div>
                </div>
            </div>

            {/* Format Selection */}
            <div className="space-y-4">
                {/* Type Toggle */}
                <div className="toggle-group">
                    <button
                        className={`toggle-option ${formatType === 'video' ? 'active' : ''}`}
                        onClick={() => setFormatType('video')}
                    >
                        <Film size={18} />
                        <span>Video</span>
                    </button>
                    <button
                        className={`toggle-option ${formatType === 'audio' ? 'active' : ''}`}
                        onClick={() => setFormatType('audio')}
                    >
                        <Music size={18} />
                        <span>Audio</span>
                    </button>
                </div>

                {/* Format & Quality Selectors */}
                <div className="grid grid-cols-2 gap-3">
                    {formatType === 'video' ? (
                        <>
                            <div>
                                <label className="block text-xs text-text-muted mb-2 uppercase tracking-wide">Format</label>
                                <select
                                    value={videoFormat}
                                    onChange={(e) => setVideoFormat(e.target.value as any)}
                                    className="select-modern"
                                >
                                    {VIDEO_FORMATS.map(f => (
                                        <option key={f} value={f}>{f.toUpperCase()}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-text-muted mb-2 uppercase tracking-wide">Quality</label>
                                <select
                                    value={quality}
                                    onChange={(e) => setQuality(e.target.value)}
                                    className="select-modern"
                                >
                                    {VIDEO_QUALITIES.map(q => (
                                        <option key={q} value={q}>{q === 'best' ? 'Best Available' : `${q}p`}</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    ) : (
                        <>
                            <div>
                                <label className="block text-xs text-text-muted mb-2 uppercase tracking-wide">Format</label>
                                <select
                                    value={audioFormat}
                                    onChange={(e) => setAudioFormat(e.target.value as any)}
                                    className="select-modern"
                                >
                                    {AUDIO_FORMATS.map(f => (
                                        <option key={f} value={f}>{f.toUpperCase()}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-text-muted mb-2 uppercase tracking-wide">Bitrate</label>
                                <select
                                    value={audioQuality}
                                    onChange={(e) => setAudioQuality(e.target.value as any)}
                                    className="select-modern"
                                >
                                    {AUDIO_BITRATES.map(b => (
                                        <option key={b} value={b}>{b} kbps</option>
                                    ))}
                                </select>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {/* Output Directory */}
            <div>
                <label className="block text-xs text-text-muted mb-2 uppercase tracking-wide">Save to</label>
                <button
                    onClick={handleSelectDirectory}
                    className="btn-secondary w-full justify-start"
                >
                    <Folder size={16} />
                    <span className="truncate flex-1 text-left">{downloadPath}</span>
                    <ChevronDown size={14} className="text-text-muted" />
                </button>
            </div>

            {/* Download Button */}
            <motion.button
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={handleDownload}
                disabled={!apiOnline || isDownloading}
                className="btn-primary w-full h-14 text-lg"
            >
                <Download size={22} />
                <span>{isDownloading ? 'Starting...' : 'Download Now'}</span>
            </motion.button>
        </motion.div>
    );
}

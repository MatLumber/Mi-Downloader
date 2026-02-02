import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VideoInfo {
    id: string;
    title: string;
    thumbnail: string | null;
    duration: number | null;
    channel: string | null;
    view_count: number | null;
    platform?: string;
    formats: Format[];
}

export interface Format {
    format_id: string;
    resolution: string;
    height: number;
    ext: string;
    type: string;
    has_audio: boolean;
    filesize: number | null;
}

export type DownloadStatus = 'queued' | 'fetching_info' | 'downloading' | 'processing' | 'completed' | 'error' | 'cancelled';

export interface DownloadTask {
    task_id: string;
    status: DownloadStatus;
    progress: number;
    speed: string;
    eta: string;
    filename: string;
    filepath: string;
    title: string;
    thumbnail: string;
    platform?: string;
    format_type: 'video' | 'audio';
    quality: string;
    error: string | null;
    started_at: Date;
    filesize: number | null;
}

export interface CompletedDownload {
    id: string;
    title: string;
    thumbnail: string;
    filename: string;
    filepath: string;
    platform?: string;
    format_type: 'video' | 'audio';
    format: string; // mp4, mkv, mp3, wav, etc.
    filesize: number;
    completed_at: Date;
}

export interface ConvertHistoryItem {
    id: string;
    title: string;
    input_path: string;
    output_path: string;
    format: string;
    media_type: 'video' | 'audio' | 'image';
    completed_at: Date;
}

export type LogLevel = 'info' | 'success' | 'warning' | 'error';

export interface LogEntry {
    id: string;
    timestamp: Date;
    level: LogLevel;
    message: string;
}

export type ActiveTab = 'queue' | 'history' | 'compress' | 'convert' | 'terminal';
export type ConvertTab = 'video' | 'audio' | 'image';

const readStoredTheme = (): 'dark' | 'light' => {
    if (typeof window === 'undefined') return 'dark';
    try {
        const stored = window.localStorage.getItem('gravitydown-theme');
        if (stored === 'light' || stored === 'dark') {
            return stored;
        }
        const persisted = window.localStorage.getItem('gravitydown-storage');
        if (persisted) {
            const parsed = JSON.parse(persisted);
            const theme = parsed?.state?.theme;
            if (theme === 'light' || theme === 'dark') {
                return theme;
            }
        }
    } catch {
        // ignore
    }
    return 'dark';
};

const writeStoredTheme = (theme: 'dark' | 'light') => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem('gravitydown-theme', theme);
    } catch {
        // ignore
    }
};

interface AppState {
    // URL Input
    url: string;
    urlValid: boolean | null;
    setUrl: (url: string) => void;

    // Video Info
    videoInfo: VideoInfo | null;
    setVideoInfo: (info: VideoInfo | null) => void;
    loadingInfo: boolean;
    setLoadingInfo: (loading: boolean) => void;

    // Format Selection
    formatType: 'video' | 'audio';
    setFormatType: (type: 'video' | 'audio') => void;
    quality: string;
    setQuality: (quality: string) => void;
    videoFormat: 'mp4' | 'mkv' | 'avi' | 'webm';
    setVideoFormat: (format: 'mp4' | 'mkv' | 'avi' | 'webm') => void;
    audioFormat: 'mp3' | 'wav' | 'flac' | 'aac' | 'opus';
    setAudioFormat: (format: 'mp3' | 'wav' | 'flac' | 'aac' | 'opus') => void;
    audioQuality: '320' | '256' | '192' | '128';
    setAudioQuality: (quality: '320' | '256' | '192' | '128') => void;

    // Download Queue (supports multiple concurrent downloads)
    downloadQueue: DownloadTask[];
    addToQueue: (task: DownloadTask) => void;
    updateTask: (taskId: string, updates: Partial<DownloadTask>) => void;
    removeFromQueue: (taskId: string) => void;
    getActiveDownloads: () => DownloadTask[];

    // Download History - Separate lists for videos and audios
    videoHistory: CompletedDownload[];
    audioHistory: CompletedDownload[];
    downloadHistory: CompletedDownload[]; // Legacy - combined getter
    addToHistory: (download: CompletedDownload) => void;
    clearHistory: () => void;
    removeFromHistory: (id: string) => void;

    // Convert History
    convertHistory: ConvertHistoryItem[];
    addConvertHistory: (entry: ConvertHistoryItem) => void;
    removeConvertHistory: (id: string) => void;
    clearConvertHistory: (mediaType?: ConvertTab) => void;

    // Active Panel Tab
    activeTab: ActiveTab;
    setActiveTab: (tab: ActiveTab) => void;

    // Convert Settings
    convertTab: ConvertTab;
    setConvertTab: (tab: ConvertTab) => void;
    convertVideoFormat: 'mp4' | 'mkv' | 'webm' | 'mov' | 'avi' | 'm4v';
    setConvertVideoFormat: (format: 'mp4' | 'mkv' | 'webm' | 'mov' | 'avi' | 'm4v') => void;
    convertAudioFormat: 'mp3' | 'aac' | 'wav' | 'flac' | 'ogg' | 'opus' | 'm4a';
    setConvertAudioFormat: (format: 'mp3' | 'aac' | 'wav' | 'flac' | 'ogg' | 'opus' | 'm4a') => void;
    convertImageFormat: 'png' | 'jpg' | 'webp' | 'bmp' | 'tiff';
    setConvertImageFormat: (format: 'png' | 'jpg' | 'webp' | 'bmp' | 'tiff') => void;
    convertVideoQuality: 'high' | 'balanced' | 'light';
    setConvertVideoQuality: (quality: 'high' | 'balanced' | 'light') => void;
    convertAudioQuality: '320' | '256' | '192' | '128';
    setConvertAudioQuality: (quality: '320' | '256' | '192' | '128') => void;
    convertImageQuality: 'high' | 'balanced' | 'light';
    setConvertImageQuality: (quality: 'high' | 'balanced' | 'light') => void;
    convertOutputDir: string;
    setConvertOutputDir: (path: string) => void;

    // Terminal Log
    logs: LogEntry[];
    addLog: (level: LogLevel, message: string) => void;
    clearLogs: () => void;

    // API Status
    apiOnline: boolean;
    setApiOnline: (online: boolean) => void;

    // Settings
    downloadPath: string;
    setDownloadPath: (path: string) => void;

    // Theme
    theme: 'dark' | 'light';
    setTheme: (theme: 'dark' | 'light') => void;

    // Compression Settings
    compressionPreset: 'high' | 'balanced' | 'light';
    setCompressionPreset: (preset: 'high' | 'balanced' | 'light') => void;
    compressionFormat: 'mp4' | 'mkv' | 'webm';
    setCompressionFormat: (format: 'mp4' | 'mkv' | 'webm') => void;
    compressionUseGpu: boolean;
    setCompressionUseGpu: (enabled: boolean) => void;
    compressionOutputDir: string;
    setCompressionOutputDir: (path: string) => void;

    // Legacy compatibility
    currentTask: DownloadTask | null;
    setCurrentTask: (task: DownloadTask | null) => void;
}

export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // URL Input
            url: '',
            urlValid: null,
            setUrl: (url: string) => {
                const isSupportedUrl = (value: string) => {
                    const raw = value.trim();
                    if (!raw) return null;

                    const supportedHosts = [
                        'youtube.com',
                        'youtu.be',
                        'tiktok.com',
                        'instagram.com',
                        'facebook.com',
                        'fb.watch',
                        'twitter.com',
                        'x.com',
                        'twitch.tv',
                    ];

                    const lower = raw.toLowerCase();
                    if (supportedHosts.some((domain) => lower.includes(domain))) {
                        return true;
                    }

                    const normalize = (rawUrl: string) => (rawUrl.startsWith('http://') || rawUrl.startsWith('https://'))
                        ? rawUrl
                        : `https://${rawUrl}`;

                    try {
                        const parsed = new URL(normalize(raw));
                        const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
                        return supportedHosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
                    } catch {
                        return false;
                    }
                };

                const isValid = isSupportedUrl(url);
                set({ url, urlValid: isValid });
            },

            // Video Info
            videoInfo: null,
            setVideoInfo: (info) => set({ videoInfo: info }),
            loadingInfo: false,
            setLoadingInfo: (loading) => set({ loadingInfo: loading }),

            // Format Selection
            formatType: 'video',
            setFormatType: (type) => set({ formatType: type }),
            quality: 'best',
            setQuality: (quality) => set({ quality }),
            videoFormat: 'mp4',
            setVideoFormat: (format) => set({ videoFormat: format }),
            audioFormat: 'mp3',
            setAudioFormat: (format) => set({ audioFormat: format }),
            audioQuality: '320',
            setAudioQuality: (quality) => set({ audioQuality: quality }),

            // Download Queue
            downloadQueue: [],
            addToQueue: (task) => set((state) => ({
                downloadQueue: [...state.downloadQueue, task]
            })),
            updateTask: (taskId, updates) => set((state) => ({
                downloadQueue: state.downloadQueue.map((task) =>
                    task.task_id === taskId ? { ...task, ...updates } : task
                )
            })),
            removeFromQueue: (taskId) => set((state) => ({
                downloadQueue: state.downloadQueue.filter((task) => task.task_id !== taskId)
            })),
            getActiveDownloads: () => {
                return get().downloadQueue.filter(
                    (t) => t.status === 'downloading' || t.status === 'processing' || t.status === 'fetching_info'
                );
            },

            // Download History - Separate lists
            videoHistory: [],
            audioHistory: [],
            get downloadHistory() {
                // Combined getter for legacy compatibility
                const state = get();
                return [...state.videoHistory, ...state.audioHistory].sort(
                    (a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime()
                );
            },
            addToHistory: (download) => set((state) => {
                if (download.format_type === 'video') {
                    return {
                        videoHistory: [download, ...state.videoHistory].slice(0, 50)
                    };
                } else {
                    return {
                        audioHistory: [download, ...state.audioHistory].slice(0, 50)
                    };
                }
            }),
            clearHistory: () => set({ videoHistory: [], audioHistory: [] }),
            removeFromHistory: (id) => set((state) => ({
                videoHistory: state.videoHistory.filter((d) => d.id !== id),
                audioHistory: state.audioHistory.filter((d) => d.id !== id)
            })),

            // Convert History
            convertHistory: [],
            addConvertHistory: (entry) => set((state) => ({
                convertHistory: [entry, ...state.convertHistory].slice(0, 50)
            })),
            removeConvertHistory: (id) => set((state) => ({
                convertHistory: state.convertHistory.filter((entry) => entry.id !== id)
            })),
            clearConvertHistory: (mediaType) => set((state) => ({
                convertHistory: mediaType
                    ? state.convertHistory.filter((entry) => entry.media_type !== mediaType)
                    : []
            })),

            // Active Tab
            activeTab: 'queue',
            setActiveTab: (tab) => set({ activeTab: tab }),

            // Convert Settings
            convertTab: 'video',
            setConvertTab: (tab) => set({ convertTab: tab }),
            convertVideoFormat: 'mp4',
            setConvertVideoFormat: (format) => set({ convertVideoFormat: format }),
            convertAudioFormat: 'mp3',
            setConvertAudioFormat: (format) => set({ convertAudioFormat: format }),
            convertImageFormat: 'webp',
            setConvertImageFormat: (format) => set({ convertImageFormat: format }),
            convertVideoQuality: 'balanced',
            setConvertVideoQuality: (quality) => set({ convertVideoQuality: quality }),
            convertAudioQuality: '192',
            setConvertAudioQuality: (quality) => set({ convertAudioQuality: quality }),
            convertImageQuality: 'balanced',
            setConvertImageQuality: (quality) => set({ convertImageQuality: quality }),
            convertOutputDir: '~/Downloads/GravityDown',
            setConvertOutputDir: (path) => set({ convertOutputDir: path }),

            // Terminal Log
            logs: [],
            addLog: (level, message) => {
                const entry: LogEntry = {
                    id: crypto.randomUUID(),
                    timestamp: new Date(),
                    level,
                    message,
                };
                set((state) => ({ logs: [...state.logs.slice(-100), entry] }));
            },
            clearLogs: () => set({ logs: [] }),

            // API Status
            apiOnline: false,
            setApiOnline: (online) => set({ apiOnline: online }),

            // Settings
            downloadPath: '~/Downloads/GravityDown',
            setDownloadPath: (path) => set({ downloadPath: path }),

            // Theme
            theme: readStoredTheme(),
            setTheme: (theme) => {
                writeStoredTheme(theme);
                set({ theme });
            },

            // Compression Settings
            compressionPreset: 'high',
            setCompressionPreset: (preset) => set({ compressionPreset: preset }),
            compressionFormat: 'mp4',
            setCompressionFormat: (format) => set({ compressionFormat: format }),
            compressionUseGpu: false,
            setCompressionUseGpu: (enabled) => set({ compressionUseGpu: enabled }),
            compressionOutputDir: '~/Downloads/GravityDown',
            setCompressionOutputDir: (path) => set({ compressionOutputDir: path }),

            // Legacy compatibility - maps to first active download
            currentTask: null,
            setCurrentTask: (task) => {
                if (task) {
                    const existing = get().downloadQueue.find((t) => t.task_id === task.task_id);
                    if (existing) {
                        get().updateTask(task.task_id, task);
                    } else {
                        get().addToQueue(task);
                    }
                }
                set({ currentTask: task });
            },
        }),
        {
            name: 'gravitydown-storage',
            partialize: (state) => ({
                // Only persist these fields
                activeTab: state.activeTab,
                formatType: state.formatType,
                quality: state.quality,
                videoHistory: state.videoHistory,
                audioHistory: state.audioHistory,
                downloadPath: state.downloadPath,
                videoFormat: state.videoFormat,
                audioFormat: state.audioFormat,
                audioQuality: state.audioQuality,
                convertHistory: state.convertHistory,
                convertTab: state.convertTab,
                convertVideoFormat: state.convertVideoFormat,
                convertAudioFormat: state.convertAudioFormat,
                convertImageFormat: state.convertImageFormat,
                convertVideoQuality: state.convertVideoQuality,
                convertAudioQuality: state.convertAudioQuality,
                convertImageQuality: state.convertImageQuality,
                convertOutputDir: state.convertOutputDir,
                compressionPreset: state.compressionPreset,
                compressionFormat: state.compressionFormat,
                compressionUseGpu: state.compressionUseGpu,
                compressionOutputDir: state.compressionOutputDir,
                theme: state.theme,
            }),
            // Handle date deserialization
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Convert date strings back to Date objects
                    state.videoHistory = state.videoHistory.map(item => ({
                        ...item,
                        completed_at: new Date(item.completed_at)
                    }));
                    state.audioHistory = state.audioHistory.map(item => ({
                        ...item,
                        completed_at: new Date(item.completed_at)
                    }));
                    state.convertHistory = (state.convertHistory || []).map(entry => ({
                        ...entry,
                        completed_at: new Date(entry.completed_at)
                    }));
                    if (state.theme) {
                        writeStoredTheme(state.theme);
                    }
                }
            }
        }
    )
);

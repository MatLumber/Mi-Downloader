import { motion } from 'framer-motion';
import { XCircle, Plus } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { startDownload, subscribeToTaskEvents } from '../api/client';
import { useCallback } from 'react';

export function LaunchButton() {
    const {
        url, urlValid, videoInfo, formatType, quality,
        addToQueue, updateTask, addLog, apiOnline,
        downloadPath, addToHistory, setVideoInfo, setUrl,
        videoFormat, audioFormat, audioQuality
    } = useAppStore();

    const isReady = urlValid && videoInfo && apiOnline;

    const handleLaunch = useCallback(async () => {
        if (!isReady) return;

        // Determine output format based on type
        const outputFormat = formatType === 'video' ? videoFormat : audioFormat;

        addLog('info', '[LAUNCH] Initiating download sequence...');
        addLog('info', `[CONFIG] Format: ${formatType.toUpperCase()} | Quality: ${quality.toUpperCase()} | Container: ${outputFormat.toUpperCase()}`);
        addLog('info', `[CONFIG] Output: ${downloadPath}`);

        // Store video info before clearing (for the task)
        const taskTitle = videoInfo?.title || '';
        const taskThumbnail = videoInfo?.thumbnail || '';

        try {
            const response = await startDownload(
                url,
                formatType,
                quality,
                downloadPath,
                outputFormat,
                formatType === 'audio' ? audioQuality : undefined
            );
            addLog('success', `[LAUNCH] Task created: ${response.task_id}`);

            // Create new task in queue
            const newTask = {
                task_id: response.task_id,
                status: 'queued' as const,
                progress: 0,
                speed: '0 B/s',
                eta: 'Calculating...',
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

            // Add to queue (allows multiple downloads)
            addToQueue(newTask);

            // Clear state for new download
            setVideoInfo(null);
            setUrl('');

            // Subscribe to SSE events
            subscribeToTaskEvents(
                response.task_id,
                (data) => {
                    const updates = {
                        status: data.status as any,
                        progress: data.progress,
                        speed: data.speed,
                        eta: data.eta,
                        filename: data.filename,
                        filepath: data.filename || '',
                        title: data.title || taskTitle,
                        error: data.error,
                    };

                    updateTask(response.task_id, updates);

                    if (data.status === 'downloading') {
                        // Silent progress update
                    } else if (data.status === 'processing') {
                        addLog('warning', '[POST] Processing with FFmpeg...');
                    } else if (data.status === 'completed') {
                        addLog('success', `[COMPLETE] File saved: ${data.filename}`);

                        // Add to history
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
                    } else if (data.status === 'error') {
                        addLog('error', `[ERROR] ${data.error}`);
                    }
                },
                (error) => {
                    addLog('error', `[SSE] Connection error: ${error.message}`);
                },
                () => {
                    addLog('info', '[SSE] Stream closed');
                }
            );

        } catch (error) {
            addLog('error', `[LAUNCH] Failed: ${error}`);
        }
    }, [isReady, url, formatType, quality, videoInfo, addLog, downloadPath, addToHistory, videoFormat, audioFormat, audioQuality, addToQueue, updateTask, setVideoInfo, setUrl]);

    const getButtonState = () => {
        if (!apiOnline) return { icon: XCircle, text: 'OFFLINE', class: 'error', disabled: true };
        if (!isReady) return { icon: Plus, text: 'SELECT VIDEO', class: 'disabled', disabled: true };
        return { icon: Plus, text: 'ADD TO QUEUE', class: 'ready', disabled: false };
    };

    const state = getButtonState();
    const Icon = state.icon;

    return (
        <motion.button
            onClick={handleLaunch}
            disabled={state.disabled}
            className={`launch-button w-full py-4 px-6 rounded-lg flex items-center justify-center gap-3 ${state.class}`}
            whileHover={!state.disabled ? { scale: 1.02 } : {}}
            whileTap={!state.disabled ? { scale: 0.98 } : {}}
        >
            <Icon className="w-5 h-5" />
            <span
                className="text-sm font-semibold tracking-widest uppercase"
                style={{ fontFamily: 'var(--font-display)' }}
            >
                {state.text}
            </span>
        </motion.button>
    );
}

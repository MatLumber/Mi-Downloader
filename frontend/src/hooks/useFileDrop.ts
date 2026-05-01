import { useEffect, useRef, useState } from 'react';

const VIDEO_EXT = /\.(mp4|mkv|webm|avi|mov|m4v)$/i;
const AUDIO_EXT = /\.(mp3|aac|wav|flac|ogg|opus|m4a)$/i;
const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

export type DropKind = 'video' | 'audio' | 'image' | 'media' | 'any';

function matchesKind(path: string, kind: DropKind): boolean {
    const lower = path.toLowerCase();
    switch (kind) {
        case 'video': return VIDEO_EXT.test(lower);
        case 'audio': return AUDIO_EXT.test(lower) || VIDEO_EXT.test(lower);
        case 'image': return IMAGE_EXT.test(lower);
        case 'media': return VIDEO_EXT.test(lower) || AUDIO_EXT.test(lower);
        case 'any': return VIDEO_EXT.test(lower) || AUDIO_EXT.test(lower) || IMAGE_EXT.test(lower);
        default: return false;
    }
}

interface UseFileDropOptions {
    /** When false, listeners are detached. Use to scope drop handling to the active screen. */
    enabled: boolean;
    kind: DropKind;
    /** Receives every path dropped in a single drag operation, deduped and pre-filtered by kind. */
    onDrop: (paths: string[]) => void;
    onReject?: (reason: string) => void;
}

/**
 * Drag & drop manager for the Electron renderer.
 *
 * Resolves paths in this order:
 *  1. The DOM drop event's `dataTransfer.files` — synchronous, gives us the full set at once.
 *     `electronAPI.getPathForFile(file)` (Electron 32+) yields a real filesystem path.
 *  2. The IPC `file-drop` channel — fallback for cases where the DOM path is unavailable.
 *     Multiple paths from the same drop arrive as separate messages, so we buffer them
 *     within an 80 ms window and flush as a single onDrop([...]) call.
 *
 * Always preventDefault on dragover/drop so the browser doesn't navigate to file://...
 * when a drop happens outside our component.
 */
export function useFileDrop({ enabled, kind, onDrop, onReject }: UseFileDropOptions) {
    const [isDragging, setIsDragging] = useState(false);
    const onDropRef = useRef(onDrop);
    const onRejectRef = useRef(onReject);
    const kindRef = useRef(kind);
    const enabledRef = useRef(enabled);

    useEffect(() => { onDropRef.current = onDrop; }, [onDrop]);
    useEffect(() => { onRejectRef.current = onReject; }, [onReject]);
    useEffect(() => { kindRef.current = kind; }, [kind]);
    useEffect(() => { enabledRef.current = enabled; }, [enabled]);

    useEffect(() => {
        if (!enabled) {
            queueMicrotask(() => setIsDragging(false));
            return;
        }

        let dragCounter = 0;
        // Buffer for IPC-delivered paths from the same drop event
        let ipcBuffer: string[] = [];
        let ipcFlushHandle: number | null = null;
        // Window after a DOM drop where we ignore IPC duplicates
        let lastDomDropAt = 0;

        const dispatch = (paths: string[]) => {
            // Dedupe by lowercase path
            const seen = new Set<string>();
            const unique: string[] = [];
            for (const p of paths) {
                const key = p.toLowerCase();
                if (seen.has(key)) continue;
                seen.add(key);
                unique.push(p);
            }
            const valid = unique.filter((p) => matchesKind(p, kindRef.current));
            const rejected = unique.length - valid.length;
            if (valid.length > 0) {
                onDropRef.current(valid);
                // If some matched and some didn't, surface a soft hint
                if (rejected > 0) {
                    onRejectRef.current?.(`${rejected} ${rejected === 1 ? 'archivo' : 'archivos'} con formato no soportado fue${rejected === 1 ? '' : 'ron'} ignorado${rejected === 1 ? '' : 's'}.`);
                }
            } else if (unique.length > 0) {
                onRejectRef.current?.(formatRejectMessage(kindRef.current));
            }
        };

        const flushIpc = () => {
            if (ipcBuffer.length === 0) return;
            const batch = ipcBuffer;
            ipcBuffer = [];
            ipcFlushHandle = null;
            // If a DOM drop already handled this, skip the IPC duplicate
            if (Date.now() - lastDomDropAt < 600) return;
            dispatch(batch);
        };

        const electronUnsub = window.electronAPI?.onFileDrop?.((filePath) => {
            if (!enabledRef.current) return;
            dragCounter = 0;
            setIsDragging(false);
            if (!filePath || typeof filePath !== 'string') return;
            ipcBuffer.push(filePath);
            if (ipcFlushHandle) window.clearTimeout(ipcFlushHandle);
            ipcFlushHandle = window.setTimeout(flushIpc, 80);
        });

        const onDragEnter = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            dragCounter += 1;
            if (dragCounter === 1) setIsDragging(true);
        };

        const onDragOver = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'copy';
        };

        const onDragLeave = (e: DragEvent) => {
            if (!e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
            e.stopPropagation();
            dragCounter = Math.max(0, dragCounter - 1);
            if (dragCounter === 0) setIsDragging(false);
        };

        const onDocDrop = (e: DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            dragCounter = 0;
            setIsDragging(false);

            const fileList = e.dataTransfer?.files;
            if (!fileList || fileList.length === 0) return;

            const paths: string[] = [];
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList[i];
                const electronPath = window.electronAPI?.getPathForFile?.(file);
                const legacyPath = (file as unknown as { path?: string }).path;
                const resolved = electronPath || legacyPath;
                if (resolved) paths.push(resolved);
            }

            if (paths.length === 0) {
                // Couldn't read paths from the DOM (newer Electron without preload exposure?).
                // The IPC channel will deliver them shortly — let the buffer collect them.
                return;
            }

            lastDomDropAt = Date.now();
            // Cancel any pending IPC flush — the DOM was authoritative here
            if (ipcFlushHandle) {
                window.clearTimeout(ipcFlushHandle);
                ipcFlushHandle = null;
            }
            ipcBuffer = [];
            dispatch(paths);
        };

        document.addEventListener('dragenter', onDragEnter);
        document.addEventListener('dragover', onDragOver);
        document.addEventListener('dragleave', onDragLeave);
        document.addEventListener('drop', onDocDrop);

        return () => {
            document.removeEventListener('dragenter', onDragEnter);
            document.removeEventListener('dragover', onDragOver);
            document.removeEventListener('dragleave', onDragLeave);
            document.removeEventListener('drop', onDocDrop);
            if (ipcFlushHandle) window.clearTimeout(ipcFlushHandle);
            if (electronUnsub) electronUnsub();
        };
    }, [enabled]);

    return { isDragging };
}

function formatRejectMessage(kind: DropKind): string {
    switch (kind) {
        case 'video': return 'Formato no soportado. Usa MP4, MKV, WEBM, AVI, MOV o M4V.';
        case 'audio': return 'Formato no soportado. Usa un video o un audio compatible.';
        case 'image': return 'Formato no soportado. Usa PNG, JPG, WEBP, BMP o TIFF.';
        case 'media': return 'Formato no soportado. Solo audio o video.';
        case 'any': return 'Formato no soportado.';
        default: return 'Formato no soportado.';
    }
}

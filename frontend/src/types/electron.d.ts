/// <reference types="vite/client" />

interface ElectronAPI {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    selectDirectory: () => Promise<string | null>;
    selectFile: (kind?: 'video' | 'audio' | 'image' | 'any') => Promise<string | null>;
    onFileDrop: (callback: (path: string) => void) => void;
    statFile: (path: string) => Promise<{ size: number } | null>;
    getAppVersion: () => Promise<string>;
    onUpdateStatus: (callback: (payload: { status: string; version?: string; percent?: number; message?: string }) => void) => (() => void) | void;
    openPath: (path: string) => void;
    showItemInFolder: (path: string) => void;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export { };

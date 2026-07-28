/// <reference types="vite/client" />

interface ElectronAPI {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
    selectDirectory: () => Promise<string | null>;
    selectFile: (kind?: 'video' | 'audio' | 'media' | 'image' | 'any' | 'cookies') => Promise<string | null>;
    selectFiles: (kind?: 'video' | 'audio' | 'media' | 'image' | 'any' | 'cookies') => Promise<string[]>;
    onFileDrop: (callback: (path: string) => void) => (() => void);
    getPathForFile: (file: File) => string | null;
    statFile: (path: string) => Promise<{ size: number } | null>;
    getAppVersion: () => Promise<string>;
    onUpdateStatus: (callback: (payload: { status: string; version?: string; percent?: number; message?: string }) => void) => (() => void) | void;
    openPath: (path: string) => void;
    showItemInFolder: (path: string) => void;
    getCompanionExtensionInfo: () => Promise<{ exists: boolean; sourceDir: string; version: string | null }>;
    exportCompanionExtension: () => Promise<{ ok: true; path: string } | { ok: false; reason: string; message?: string; sourceDir?: string }>;
    getBackendStatus: () => Promise<BackendStatus>;
    restartBackend: () => Promise<{ ready: boolean; baseUrl: string; port: number }>;
    openBackendLog: () => Promise<string>;
    onBackendStatus: (callback: (payload: BackendStatus) => void) => (() => void);
    onRepairStatus: (callback: (payload: RepairStatus) => void) => (() => void);
}

interface RepairStatus {
    phase: 'start' | 'download' | 'done' | 'failed';
    component?: string;
    components?: string[];
    percent?: number;
    message?: string;
    repaired?: string[];
    failed?: { component: string; error: string }[];
}

interface BackendStatus {
    ready: boolean;
    baseUrl: string;
    port: number;
    restarts: number;
}

declare global {
    interface Window {
        electronAPI?: ElectronAPI;
    }
}

export { };

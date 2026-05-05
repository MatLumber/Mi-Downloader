import { Sun, Moon, KeyRound, FileText, X, Puzzle, FolderOpen, RefreshCw, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { CookiesBrowser } from '../../store/useAppStore';
import { PathPicker } from '../shared/PathPicker';
import { getCookiesSyncStatus, clearSyncedCookies, type CookiesSyncStatus } from '../../api/client';

const BROWSERS: { value: CookiesBrowser; label: string }[] = [
    { value: 'chrome', label: 'Chrome' },
    { value: 'edge', label: 'Edge' },
    { value: 'firefox', label: 'Firefox' },
    { value: 'brave', label: 'Brave' },
    { value: 'opera', label: 'Opera' },
    { value: 'vivaldi', label: 'Vivaldi' },
    { value: 'chromium', label: 'Chromium' },
    { value: 'safari', label: 'Safari' },
];

export function SettingsView() {
    const {
        theme, setTheme,
        downloadPath, setDownloadPath,
        compressionOutputDir, setCompressionOutputDir,
        convertOutputDir, setConvertOutputDir,
        videoFormat, setVideoFormat,
        audioFormat, setAudioFormat,
        audioQuality, setAudioQuality,
        clearHistory, clearConvertHistory,
        videoHistory, audioHistory, convertHistory,
        useBrowserCookies, setUseBrowserCookies,
        cookiesBrowser, setCookiesBrowser,
        cookiesFile, setCookiesFile,
    } = useAppStore();

    const pickCookiesFile = async () => {
        const file = await window.electronAPI?.selectFile?.('cookies');
        if (file) setCookiesFile(file);
    };

    const [syncStatus, setSyncStatus] = useState<CookiesSyncStatus | null>(null);
    const [extensionInfo, setExtensionInfo] = useState<{ exists: boolean; sourceDir: string; version: string | null } | null>(null);
    const [exportingExtension, setExportingExtension] = useState(false);
    const [exportedPath, setExportedPath] = useState<string | null>(null);

    const refreshSyncStatus = async () => {
        try {
            const s = await getCookiesSyncStatus();
            setSyncStatus(s);
        } catch {
            setSyncStatus(null);
        }
    };

    useEffect(() => {
        refreshSyncStatus();
        window.electronAPI?.getCompanionExtensionInfo?.().then(setExtensionInfo).catch(() => setExtensionInfo(null));
        const interval = setInterval(refreshSyncStatus, 10000);
        return () => clearInterval(interval);
    }, []);

    const handleExportExtension = async () => {
        if (!window.electronAPI?.exportCompanionExtension) return;
        setExportingExtension(true);
        setExportedPath(null);
        try {
            const result = await window.electronAPI.exportCompanionExtension();
            if (result.ok) {
                setExportedPath(result.path);
            }
        } finally {
            setExportingExtension(false);
        }
    };

    const handleClearSync = async () => {
        try {
            await clearSyncedCookies();
            await refreshSyncStatus();
        } catch { /* swallow — UI will refresh on next poll */ }
    };

    const fmtAgo = (iso: string | null) => {
        if (!iso) return null;
        const ts = new Date(iso).getTime();
        if (!ts) return null;
        const diffSec = Math.round((Date.now() - ts) / 1000);
        if (diffSec < 60) return `hace ${diffSec}s`;
        const min = Math.round(diffSec / 60);
        if (min < 60) return `hace ${min} min`;
        const hr = Math.round(min / 60);
        if (hr < 24) return `hace ${hr}h`;
        return `hace ${Math.round(hr / 24)}d`;
    };

    const pickDir = async (setter: (p: string) => void) => {
        const dir = await window.electronAPI?.selectDirectory?.();
        if (dir) setter(dir);
    };

    return (
        <div className="content-inner">
            <header className="page-header">
                <div className="page-eyebrow">Ajustes</div>
                <h1 className="page-title">Preferencias</h1>
                <p className="page-subtitle">Personaliza tema, carpetas por defecto y formatos preferidos. Todo se guarda localmente.</p>
            </header>

            <div className="surface surface-pad" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ marginBottom: 6 }}>Apariencia</div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Tema</div>
                        <div className="settings-desc">Alterna entre modo oscuro estudio y modo papel claro.</div>
                    </div>
                    <div className="settings-row-control">
                        <div className="seg">
                            <button
                                className={`seg-item ${theme === 'dark' ? 'is-active' : ''}`}
                                onClick={() => setTheme('dark')}
                            >
                                <Moon size={13} />
                                <span>Oscuro</span>
                            </button>
                            <button
                                className={`seg-item ${theme === 'light' ? 'is-active' : ''}`}
                                onClick={() => setTheme('light')}
                            >
                                <Sun size={13} />
                                <span>Claro</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="surface surface-pad" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ marginBottom: 6 }}>Carpetas por defecto</div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Descargas</div>
                        <div className="settings-desc">Donde se guardan los archivos bajados.</div>
                    </div>
                    <div className="settings-row-control" style={{ minWidth: 280 }}>
                        <PathPicker label="Descargas" value={downloadPath} onPick={() => pickDir(setDownloadPath)} />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Comprimidos</div>
                        <div className="settings-desc">Salida del compresor.</div>
                    </div>
                    <div className="settings-row-control" style={{ minWidth: 280 }}>
                        <PathPicker label="Comprimidos" value={compressionOutputDir || downloadPath} onPick={() => pickDir(setCompressionOutputDir)} />
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Convertidos</div>
                        <div className="settings-desc">Salida del conversor.</div>
                    </div>
                    <div className="settings-row-control" style={{ minWidth: 280 }}>
                        <PathPicker label="Convertidos" value={convertOutputDir} onPick={() => pickDir(setConvertOutputDir)} />
                    </div>
                </div>
            </div>

            <div className="surface surface-pad" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ marginBottom: 6 }}>Formatos preferidos</div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Video por defecto</div>
                        <div className="settings-desc">Formato sugerido al iniciar una nueva descarga.</div>
                    </div>
                    <div className="settings-row-control">
                        <div className="seg">
                            {(['mp4', 'mkv', 'webm', 'avi'] as const).map((f) => (
                                <button
                                    key={f}
                                    className={`seg-item ${videoFormat === f ? 'is-active' : ''}`}
                                    onClick={() => setVideoFormat(f)}
                                >
                                    {f.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Audio por defecto</div>
                        <div className="settings-desc">Formato sugerido al extraer audio.</div>
                    </div>
                    <div className="settings-row-control">
                        <div className="seg">
                            {(['mp3', 'wav', 'flac', 'aac', 'opus'] as const).map((f) => (
                                <button
                                    key={f}
                                    className={`seg-item ${audioFormat === f ? 'is-active' : ''}`}
                                    onClick={() => setAudioFormat(f)}
                                >
                                    {f.toUpperCase()}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Bitrate de audio</div>
                        <div className="settings-desc">Calidad por defecto al extraer audio.</div>
                    </div>
                    <div className="settings-row-control">
                        <div className="seg">
                            {(['320', '256', '192', '128'] as const).map((q) => (
                                <button
                                    key={q}
                                    className={`seg-item ${audioQuality === q ? 'is-active' : ''}`}
                                    onClick={() => setAudioQuality(q)}
                                >
                                    {q}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            <div className="surface surface-pad" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <KeyRound size={14} strokeWidth={1.8} />
                    Cookies del navegador
                </div>
                <p className="page-subtitle" style={{ fontSize: 13, marginBottom: 4 }}>
                    Algunos videos requieren sesión iniciada (edad-restringidos, miembros, privados). Activa esta opción para reutilizar las cookies de tu navegador.
                </p>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Activar cookies</div>
                        <div className="settings-desc">Pasa las cookies del navegador seleccionado a yt-dlp en cada descarga.</div>
                    </div>
                    <div className="settings-row-control">
                        <button
                            type="button"
                            className={`gpu-toggle ${useBrowserCookies ? 'is-active' : ''}`}
                            onClick={() => setUseBrowserCookies(!useBrowserCookies)}
                            style={{ minWidth: 140 }}
                        >
                            <div className="gpu-switch" />
                            <div className="gpu-text">
                                <div className="gpu-name">{useBrowserCookies ? 'Activadas' : 'Desactivadas'}</div>
                            </div>
                        </button>
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Navegador</div>
                        <div className="settings-desc">Cierra el navegador antes de descargar para evitar bloqueos de la base de cookies.</div>
                    </div>
                    <div className="settings-row-control">
                        <select
                            className="select-native"
                            value={cookiesBrowser}
                            onChange={(e) => setCookiesBrowser(e.target.value as CookiesBrowser)}
                            disabled={!useBrowserCookies || !!cookiesFile}
                            style={{ minWidth: 180 }}
                        >
                            {BROWSERS.map((b) => (
                                <option key={b.value} value={b.value}>{b.label}</option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                    <div className="settings-row-text">
                        <div className="settings-name">Archivo cookies.txt (recomendado)</div>
                        <div className="settings-desc">
                            Si Chrome falla con error de cifrado, exporta las cookies con la extensión{' '}
                            <strong>“Get cookies.txt LOCALLY”</strong> (Chrome / Firefox / Edge) en la pestaña de
                            YouTube y selecciona el archivo aquí. Esto sortea el cifrado app-bound de Chrome 127+
                            y evita tener que cerrar el navegador.
                        </div>
                        {cookiesFile && (
                            <div className="settings-desc" style={{ marginTop: 6, wordBreak: 'break-all', color: 'var(--ink)' }}>
                                <FileText size={11} strokeWidth={2} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                                <code style={{ fontSize: 11 }}>{cookiesFile}</code>
                            </div>
                        )}
                    </div>
                    <div className="settings-row-control" style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={pickCookiesFile}
                            disabled={!useBrowserCookies}
                        >
                            <FileText size={12} strokeWidth={2} />
                            <span>{cookiesFile ? 'Cambiar archivo' : 'Importar archivo'}</span>
                        </button>
                        {cookiesFile && (
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() => setCookiesFile(null)}
                                title="Quitar archivo y volver a usar el navegador"
                            >
                                <X size={12} strokeWidth={2} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="surface surface-pad" style={{ marginBottom: 18 }}>
                <div className="section-title" style={{ marginBottom: 6, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <Puzzle size={14} strokeWidth={1.8} />
                    Extensión Companion (sincronización automática)
                </div>
                <p className="page-subtitle" style={{ fontSize: 13, marginBottom: 4 }}>
                    Una pequeña extensión de navegador incluida con la app. Lee las cookies de YouTube
                    vía la API oficial de Chrome (sortea el cifrado app-bound de Chrome 127+) y las
                    envía automáticamente al backend local. Una vez instalada, las descargas funcionan
                    sin que tengas que volver a hacer nada.
                </p>

                <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                    <div className="settings-row-text">
                        <div className="settings-name">Instalación (una sola vez)</div>
                        <div className="settings-desc" style={{ lineHeight: 1.6 }}>
                            <ol style={{ paddingLeft: 18, margin: '4px 0 0' }}>
                                <li>Pulsa <strong>Exportar carpeta</strong>. Elige dónde guardarla (Documentos por ejemplo).</li>
                                <li>En tu navegador abre <code>chrome://extensions</code> (o <code>edge://extensions</code>, <code>brave://extensions</code>…).</li>
                                <li>Activa <strong>Modo de desarrollador</strong> (esquina superior derecha).</li>
                                <li>Pulsa <strong>Cargar descomprimida</strong> y selecciona la carpeta que acabas de exportar.</li>
                                <li>Vuelve aquí. Asegúrate de tener YouTube abierto y la sesión iniciada — la extensión sincroniza sola.</li>
                            </ol>
                        </div>
                        {exportedPath && (
                            <div className="settings-desc" style={{ marginTop: 8, color: 'var(--ink)' }}>
                                <Check size={11} strokeWidth={2.4} style={{ verticalAlign: '-1px', marginRight: 4, color: '#2a7d3a' }} />
                                Carpeta exportada en: <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{exportedPath}</code>
                            </div>
                        )}
                        {extensionInfo && extensionInfo.version && (
                            <div className="settings-desc" style={{ marginTop: 6, opacity: 0.7 }}>
                                Versión empaquetada: v{extensionInfo.version}
                            </div>
                        )}
                    </div>
                    <div className="settings-row-control" style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleExportExtension}
                            disabled={exportingExtension || (extensionInfo ? !extensionInfo.exists : false)}
                            style={{ minWidth: 180 }}
                        >
                            <FolderOpen size={12} strokeWidth={2} />
                            <span>{exportingExtension ? 'Exportando…' : 'Exportar carpeta'}</span>
                        </button>
                    </div>
                </div>

                <div className="settings-row" style={{ alignItems: 'flex-start' }}>
                    <div className="settings-row-text">
                        <div className="settings-name">Estado de sincronización</div>
                        <div className="settings-desc">
                            {syncStatus?.exists && syncStatus.timestamp ? (
                                <>
                                    <Check size={11} strokeWidth={2.4} style={{ verticalAlign: '-1px', marginRight: 4, color: '#2a7d3a' }} />
                                    Sincronizado {fmtAgo(syncStatus.timestamp) || 'recientemente'} —{' '}
                                    <strong>{syncStatus.count} cookies</strong>. Las descargas con cookies activadas usarán
                                    automáticamente este archivo.
                                </>
                            ) : (
                                <>Aún no se ha recibido ninguna sincronización. Abre el popup de la extensión y pulsa “Sincronizar ahora”, o navega a youtube.com.</>
                            )}
                        </div>
                        {syncStatus?.path && (
                            <div className="settings-desc" style={{ marginTop: 6, opacity: 0.7, wordBreak: 'break-all' }}>
                                <code style={{ fontSize: 11 }}>{syncStatus.path}</code>
                            </div>
                        )}
                    </div>
                    <div className="settings-row-control" style={{ display: 'flex', gap: 8 }}>
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={refreshSyncStatus}
                            title="Refrescar estado"
                        >
                            <RefreshCw size={12} strokeWidth={2} />
                        </button>
                        {syncStatus?.exists && (
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={handleClearSync}
                                title="Borrar las cookies sincronizadas (no afecta a la extensión)"
                            >
                                <X size={12} strokeWidth={2} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="surface surface-pad">
                <div className="section-title" style={{ marginBottom: 6 }}>Datos locales</div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Historial de descargas</div>
                        <div className="settings-desc">{videoHistory.length + audioHistory.length} entradas guardadas.</div>
                    </div>
                    <div className="settings-row-control">
                        <button className="btn btn-danger" onClick={clearHistory} disabled={videoHistory.length + audioHistory.length === 0}>
                            Vaciar
                        </button>
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Historial de conversiones</div>
                        <div className="settings-desc">{convertHistory.length} entradas guardadas.</div>
                    </div>
                    <div className="settings-row-control">
                        <button className="btn btn-danger" onClick={() => clearConvertHistory()} disabled={convertHistory.length === 0}>
                            Vaciar
                        </button>
                    </div>
                </div>

                <div className="settings-row">
                    <div className="settings-row-text">
                        <div className="settings-name">Atajo</div>
                        <div className="settings-desc">Pulsa Enter en la barra de URL para analizar.</div>
                    </div>
                    <div className="settings-row-control">
                        <span className="kbd">Enter</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

import { Sun, Moon, KeyRound } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { CookiesBrowser } from '../../store/useAppStore';
import { PathPicker } from '../shared/PathPicker';

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
    } = useAppStore();

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
                            disabled={!useBrowserCookies}
                            style={{ minWidth: 180 }}
                        >
                            {BROWSERS.map((b) => (
                                <option key={b.value} value={b.value}>{b.label}</option>
                            ))}
                        </select>
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

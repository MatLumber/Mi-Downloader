import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { DownloaderView } from './components/views/DownloaderView';
import { CompressView } from './components/views/CompressView';
import { ConvertView } from './components/views/ConvertView';
import { HistoryView } from './components/views/HistoryView';
import { SettingsView } from './components/views/SettingsView';
import { ToastProvider } from './components/shared/Toast';
import { useAppStore } from './store/useAppStore';
import { checkApiHealth } from './api/client';

function App() {
    const setApiOnline = useAppStore((s) => s.setApiOnline);
    const apiOnline = useAppStore((s) => s.apiOnline);
    const theme = useAppStore((s) => s.theme);
    const activeTab = useAppStore((s) => s.activeTab);
    const [appVersion, setAppVersion] = useState('');
    const [updateStatus, setUpdateStatus] = useState('');

    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute('data-theme', theme);
        root.style.colorScheme = theme;
    }, [theme]);

    useEffect(() => {
        const tick = async () => setApiOnline(await checkApiHealth());
        tick();
        const id = window.setInterval(tick, 5000);
        return () => window.clearInterval(id);
    }, [setApiOnline]);

    useEffect(() => {
        let mounted = true;
        window.electronAPI?.getAppVersion?.().then((v) => {
            if (mounted && v) setAppVersion(v);
        }).catch(() => { });
        return () => { mounted = false; };
    }, []);

    useEffect(() => {
        const unsub = window.electronAPI?.onUpdateStatus?.((payload) => {
            if (!payload) return;
            switch (payload.status) {
                case 'downloaded':
                    setUpdateStatus(`Actualización ${payload.version} lista. Reiniciando…`); break;
                case 'downloading':
                    setUpdateStatus(`Descargando actualización · ${Math.round(payload.percent || 0)}%`); break;
                case 'available':
                    setUpdateStatus(`Nueva versión ${payload.version} disponible`); break;
                case 'error':
                    setUpdateStatus('No se pudo actualizar automáticamente'); break;
                default:
                    setUpdateStatus('');
            }
        });
        return () => { if (typeof unsub === 'function') unsub(); };
    }, []);

    return (
        <ToastProvider>
            <div className="app-shell">
                <TitleBar />

                <AnimatePresence>
                    {updateStatus && (
                        <motion.div
                            key="banner"
                            className="update-banner"
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                        >
                            {updateStatus}
                        </motion.div>
                    )}
                </AnimatePresence>

                <main className="app-main">
                    <Sidebar />
                    <div className="content">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={activeTab}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -4 }}
                                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            >
                                {activeTab === 'queue' && <DownloaderView />}
                                {activeTab === 'compress' && <CompressView />}
                                {activeTab === 'convert' && <ConvertView />}
                                {activeTab === 'history' && <HistoryView />}
                                {activeTab === 'settings' && <SettingsView />}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </main>

                <footer className="app-footer">
                    <div className="footer-cluster">
                        <span className={`status-dot ${apiOnline ? 'is-online' : 'is-offline'}`} />
                        <span>{apiOnline ? 'Motor activo' : 'Sin conexión al motor'}</span>
                    </div>
                    <div className="footer-cluster">
                        <span>GravityDown</span>
                        {appVersion && <span>v{appVersion}</span>}
                    </div>
                </footer>
            </div>
        </ToastProvider>
    );
}

export default App;

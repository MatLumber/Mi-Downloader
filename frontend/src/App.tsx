import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { MainPanel } from './components/MainPanel';
import { useAppStore } from './store/useAppStore';
import { checkApiHealth } from './api/client';

function App() {
  const setApiOnline = useAppStore((state) => state.setApiOnline);
  const theme = useAppStore((state) => state.theme);
  const [appVersion, setAppVersion] = useState<string>('');
  const [updateStatus, setUpdateStatus] = useState<string>('');

  // Check API health on mount and periodically
  useEffect(() => {
    const checkHealth = async () => {
      const online = await checkApiHealth();
      setApiOnline(online);
    };

    checkHealth();
    const interval = setInterval(checkHealth, 5000);
    return () => clearInterval(interval);
  }, [setApiOnline]);

  useEffect(() => {
    let mounted = true;
    const loadVersion = async () => {
      try {
        const version = await window.electronAPI?.getAppVersion?.();
        if (mounted && version) {
          setAppVersion(version);
        }
      } catch {
        // ignore
      }
    };

    loadVersion();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const unsubscribe = window.electronAPI?.onUpdateStatus?.((payload) => {
      if (!payload) return;
      if (payload.status === 'downloaded') {
        setUpdateStatus(`Actualizacion descargada (${payload.version}). Se reiniciara en segundos...`);
      } else if (payload.status === 'downloading') {
        setUpdateStatus(`Descargando actualizacion... ${Math.round(payload.percent || 0)}%`);
      } else if (payload.status === 'available') {
        setUpdateStatus(`Nueva version disponible (${payload.version}). Descargando...`);
      } else if (payload.status === 'error') {
        setUpdateStatus('No se pudo actualizar automaticamente.');
      } else {
        setUpdateStatus('');
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  return (
    <div className="app-shell">
      {/* Ambient Glow Effect */}
      <div className="ambient-glow" />

      {/* Title Bar */}
      <TitleBar />

      {/* Main Content - Centered */}
      <main className="app-main">
        <MainPanel />
      </main>

      {updateStatus && (
        <div className="update-banner">
          {updateStatus}
        </div>
      )}

      {/* Status Bar */}
      <footer
        className="app-footer px-6 flex items-center justify-center"
        style={{
          background: 'var(--obsidian-800)',
          borderTop: '1px solid var(--obsidian-600)',
          fontFamily: 'var(--font-mono)',
          fontSize: '12px',
          color: 'var(--text-zinc)'
        }}
      >
        <span className="flex items-center gap-2">
          Creado con <Heart size={14} className="text-rose-400" /> por Mati
        </span>
        {appVersion && (
          <span className="app-version">v{appVersion}</span>
        )}
      </footer>
    </div>
  );
}

export default App;

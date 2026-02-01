import { useEffect, useState } from 'react';
import { Heart } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { MainPanel } from './components/MainPanel';
import { useAppStore } from './store/useAppStore';
import { checkApiHealth } from './api/client';

function App() {
  const { setApiOnline } = useAppStore();
  const [appVersion, setAppVersion] = useState<string>('');

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

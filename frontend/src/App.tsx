import { useEffect } from 'react';
import { Heart } from 'lucide-react';
import { TitleBar } from './components/TitleBar';
import { MainPanel } from './components/MainPanel';
import { useAppStore } from './store/useAppStore';
import { checkApiHealth } from './api/client';

function App() {
  const { setApiOnline } = useAppStore();

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
      </footer>
    </div>
  );
}

export default App;

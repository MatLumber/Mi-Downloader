import { Minus, Square, X, Sun, Moon } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store/useAppStore';

export function TitleBar() {
    const theme = useAppStore((s) => s.theme);
    const setTheme = useAppStore((s) => s.setTheme);
    const isLight = theme === 'light';

    return (
        <header className="titlebar">
            <div className="titlebar-brand">
                <div className="titlebar-mark" aria-hidden>GD</div>
                <span className="titlebar-name">GravityDown</span>
                <span className="titlebar-tag">Studio</span>
            </div>

            <div className="titlebar-actions">
                <button
                    type="button"
                    onClick={() => setTheme(isLight ? 'dark' : 'light')}
                    className="theme-toggle"
                    aria-label={isLight ? 'Cambiar a tema oscuro' : 'Cambiar a tema claro'}
                    title={isLight ? 'Tema oscuro' : 'Tema claro'}
                >
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.span
                            key={theme}
                            className="theme-toggle-icon"
                            initial={{ rotate: -90, opacity: 0 }}
                            animate={{ rotate: 0, opacity: 1 }}
                            exit={{ rotate: 90, opacity: 0 }}
                            transition={{ duration: 0.18 }}
                        >
                            {isLight ? <Sun size={14} strokeWidth={1.8} /> : <Moon size={14} strokeWidth={1.8} />}
                        </motion.span>
                    </AnimatePresence>
                </button>

                <button className="tb-btn" onClick={() => window.electronAPI?.minimize()} aria-label="Minimizar">
                    <Minus size={14} />
                </button>
                <button className="tb-btn" onClick={() => window.electronAPI?.maximize()} aria-label="Maximizar">
                    <Square size={11} />
                </button>
                <button className="tb-btn is-close" onClick={() => window.electronAPI?.close()} aria-label="Cerrar">
                    <X size={14} />
                </button>
            </div>
        </header>
    );
}

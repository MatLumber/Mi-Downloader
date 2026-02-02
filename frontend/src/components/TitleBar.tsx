import { motion } from 'framer-motion';
import { Minus, Moon, Square, Sun, X } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

// Logo SVG PRO Premium - GD Monogram
function LogoPro() {
    return (
        <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="logo-pro">
            <defs>
                <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#38BDF8" />
                    <stop offset="50%" stopColor="#22D3EE" />
                    <stop offset="100%" stopColor="#818CF8" />
                </linearGradient>
                <linearGradient id="logoGradientHover" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#22D3EE" />
                    <stop offset="50%" stopColor="#818CF8" />
                    <stop offset="100%" stopColor="#38BDF8" />
                </linearGradient>
                <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                    <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                    </feMerge>
                </filter>
            </defs>
            {/* Outer glass ring */}
            <circle cx="18" cy="18" r="17" stroke="url(#logoGradient)" strokeWidth="1.5" fill="none" opacity="0.6" />
            <circle cx="18" cy="18" r="15" stroke="url(#logoGradient)" strokeWidth="0.5" fill="none" opacity="0.3" />
            {/* G letter - stylized */}
            <path
                d="M12 11C12 9.34315 13.3431 8 15 8H19C20.6569 8 22 9.34315 22 11V13C22 13.5523 21.5523 14 21 14H17C16.4477 14 16 13.5523 16 13V12C16 11.4477 15.5523 11 15 11C14.4477 11 14 11.4477 14 12V18C14 19.6569 15.3431 21 17 21H19C20.6569 21 22 19.6569 22 18V16"
                stroke="url(#logoGradient)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                filter="url(#glow)"
            />
            {/* D letter - integrated */}
            <path
                d="M20 15H22C23.6569 15 25 16.3431 25 18V21C25 22.6569 23.6569 24 22 24H20C18.3431 24 17 22.6569 17 21V18"
                stroke="url(#logoGradient)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                filter="url(#glow)"
            />
            {/* Accent dot */}
            <circle cx="26" cy="10" r="2" fill="url(#logoGradient)" filter="url(#glow)" />
        </svg>
    );
}

export function TitleBar() {
    const theme = useAppStore((state) => state.theme);
    const setTheme = useAppStore((state) => state.setTheme);
    const isLight = theme === 'light';

    const handleMinimize = () => window.electronAPI?.minimize();
    const handleMaximize = () => window.electronAPI?.maximize();
    const handleClose = () => window.electronAPI?.close();
    const handleToggleTheme = () => setTheme(isLight ? 'dark' : 'light');

    return (
        <header
            className="title-bar h-12 px-5 flex items-center justify-between relative z-50"
        >
            {/* Logo & Title PRO */}
            <motion.div 
                className="flex items-center gap-4"
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            >
                <motion.div
                    className="logo-container"
                    whileHover={{ scale: 1.08 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                    <LogoPro />
                </motion.div>
                <div className="flex items-center gap-2">
                    <span className="app-title">
                        GravityDown
                    </span>
                    <span className="pro-badge">PRO</span>
                </div>
            </motion.div>

            {/* Window Controls */}
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={handleToggleTheme}
                    className={`theme-toggle ${isLight ? 'is-light' : 'is-dark'}`}
                    aria-label={isLight ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
                    title={isLight ? 'Modo oscuro' : 'Modo claro'}
                >
                    <span className="theme-toggle-icon">
                        <Moon size={13} />
                    </span>
                    <span className="theme-toggle-icon">
                        <Sun size={13} />
                    </span>
                </button>
                <div className="flex items-center gap-1">
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleMinimize}
                        className="title-bar-btn"
                    >
                        <Minus size={14} />
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleMaximize}
                        className="title-bar-btn"
                    >
                        <Square size={10} />
                    </motion.button>
                    <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleClose}
                        className="title-bar-btn close"
                    >
                        <X size={14} />
                    </motion.button>
                </div>
            </div>
        </header>
    );
}

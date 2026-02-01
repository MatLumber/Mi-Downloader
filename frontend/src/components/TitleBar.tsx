import { motion } from 'framer-motion';
import { Minus, Square, X } from 'lucide-react';


export function TitleBar() {

    const handleMinimize = () => window.electronAPI?.minimize();
    const handleMaximize = () => window.electronAPI?.maximize();
    const handleClose = () => window.electronAPI?.close();

    return (
        <header
            className="title-bar h-11 px-4 flex items-center justify-between relative z-50"
        >
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
                <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: 'var(--gradient-primary)' }}
                >
                    <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                </div>
                <span
                    className="text-sm font-semibold"
                    style={{ fontFamily: 'var(--font-display)', color: 'var(--text-white)' }}
                >
                    GravityDown
                </span>
            </div>

            {/* Window Controls */}
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
        </header>
    );
}

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { LogEntry } from '../store/useAppStore';


function LogLine({ entry }: { entry: LogEntry }) {
    const timeStr = entry.timestamp.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    return (
        <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            className={`terminal-line py-0.5 ${entry.level}`}
        >
            <span className="text-gray-600 mr-2">[{timeStr}]</span>
            <span>{entry.message}</span>
        </motion.div>
    );
}

export function TerminalLog() {
    const containerRef = useRef<HTMLDivElement>(null);
    const { logs, currentTask } = useAppStore();

    // Auto-scroll to bottom
    useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="flex flex-col h-full"
        >
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[var(--terminal-green)]" />
                    <span
                        className="text-xs uppercase tracking-widest text-gray-500 font-medium"
                        style={{ fontFamily: 'var(--font-mono)' }}
                    >
                        System Log
                    </span>
                </div>

                {currentTask && (
                    <div className="flex items-center gap-2">
                        <div className={`status-dot ${currentTask.status === 'completed' ? 'online' :
                            currentTask.status === 'error' ? 'error' : 'processing'
                            }`} />
                        <span
                            className="text-xs text-gray-400 uppercase"
                            style={{ fontFamily: 'var(--font-mono)' }}
                        >
                            {currentTask.status}
                        </span>
                    </div>
                )}
            </div>

            {/* Progress Bar (if downloading) */}
            <AnimatePresence>
                {currentTask && currentTask.status === 'downloading' && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mb-3"
                    >
                        <div className="flex items-center justify-between mb-1">
                            <span
                                className="data-stream text-lg font-bold"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            >
                                {currentTask.progress.toFixed(1)}%
                            </span>
                            <div className="flex items-center gap-4 text-xs text-gray-400" style={{ fontFamily: 'var(--font-mono)' }}>
                                <span>↓ {currentTask.speed}</span>
                                <span>ETA: {currentTask.eta}</span>
                            </div>
                        </div>

                        <div className="progress-container h-2 rounded-full">
                            <motion.div
                                className="progress-bar h-full rounded-full"
                                initial={{ width: 0 }}
                                animate={{ width: `${currentTask.progress}%` }}
                                transition={{ duration: 0.3, ease: 'easeOut' }}
                            />
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Log Container */}
            <div
                ref={containerRef}
                className="terminal-log flex-1 p-3 rounded-lg overflow-y-auto min-h-0"
            >
                {logs.length === 0 ? (
                    <div className="text-gray-600 text-center py-8">
                        <Terminal className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>Awaiting commands...</p>
                    </div>
                ) : (
                    <AnimatePresence mode="popLayout">
                        {logs.map((entry) => (
                            <LogLine key={entry.id} entry={entry} />
                        ))}
                    </AnimatePresence>
                )}
            </div>
        </motion.div>
    );
}

import { motion } from 'framer-motion';
import { FolderOpen } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

export function DirectorySelector() {
    const { downloadPath, setDownloadPath } = useAppStore();

    const handleSelectDirectory = async () => {
        if (window.electronAPI?.selectDirectory) {
            const path = await window.electronAPI.selectDirectory();
            if (path) {
                setDownloadPath(path);
            }
        }
    };

    return (
        <motion.div
            className="pt-4 border-t border-steel-border"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
        >
            <div className="flex items-center justify-between text-xs mb-2" style={{ fontFamily: 'var(--font-mono)' }}>
                <span className="text-gray-500 uppercase tracking-wider">Output Directory</span>
            </div>

            <button
                onClick={handleSelectDirectory}
                className="w-full flex items-center justify-between p-3 rounded bg-void-deep border border-steel-border hover:border-steel-light hover:bg-steel-grey transition-all group"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <FolderOpen size={16} className="text-terminal-green opacity-70 group-hover:opacity-100 transition-opacity" />
                    <span
                        className="text-gray-400 group-hover:text-gray-200 truncate text-xs font-mono transition-colors text-left"
                        title={downloadPath}
                    >
                        {downloadPath.replace(/\\/g, '/')}
                    </span>
                </div>
                <div className="px-2 py-1 rounded bg-black/30 text-[10px] text-gray-500 group-hover:text-terminal-green transition-colors uppercase font-bold tracking-wider">
                    Change
                </div>
            </button>
        </motion.div>
    );
}



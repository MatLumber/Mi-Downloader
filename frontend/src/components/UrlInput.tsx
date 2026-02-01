import { useState } from 'react';
import { motion } from 'framer-motion';
import { Link, Loader2, Search } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { fetchVideoInfo } from '../api/client';

export function UrlInput() {
    const { url, urlValid, setUrl, setVideoInfo, loadingInfo, setLoadingInfo, apiOnline } = useAppStore();
    const [focused, setFocused] = useState(false);

    const handleFetch = async () => {
        if (!urlValid || loadingInfo || !apiOnline) return;

        setLoadingInfo(true);
        setVideoInfo(null);

        try {
            const info = await fetchVideoInfo(url);
            setVideoInfo(info);
        } catch (error) {
            console.error('[FETCH] Failed:', error);
        } finally {
            setLoadingInfo(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleFetch();
        }
    };

    const getInputClass = () => {
        let base = 'input-modern';
        if (urlValid === true) base += ' valid';
        if (urlValid === false) base += ' invalid';
        return base;
    };

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative"
        >
            {/* Input Container */}
            <div className="relative flex gap-3">
                {/* Icon */}
                <div className="absolute left-4 top-1/2 -translate-y-1/2 z-10">
                    <Link className="w-5 h-5 text-text-muted" />
                </div>

                {/* Input Field */}
                <input
                    type="text"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={handleKeyDown}
                    placeholder="Paste YouTube URL here..."
                    className={getInputClass()}
                    disabled={loadingInfo}
                    style={{ flex: 1 }}
                />

                {/* Fetch Button */}
                <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleFetch}
                    disabled={!urlValid || loadingInfo || !apiOnline}
                    className="btn-primary"
                >
                    {loadingInfo ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Search className="w-5 h-5" />
                    )}
                    <span>{loadingInfo ? 'Loading...' : 'Fetch'}</span>
                </motion.button>
            </div>

            {/* Status Text */}
            <div className="flex items-center justify-between mt-3 px-1">
                <span className="text-xs text-text-muted">
                    Supports YouTube videos, shorts, and playlists
                </span>
                {url.length > 0 && (
                    <span className={`text-xs font-medium ${urlValid ? 'text-success' : 'text-error'}`}>
                        {urlValid ? '✓ Valid URL' : '✗ Invalid URL'}
                    </span>
                )}
            </div>

            {/* Focus Glow */}
            {focused && urlValid && (
                <motion.div
                    className="absolute -inset-2 rounded-2xl pointer-events-none"
                    style={{
                        background: 'radial-gradient(ellipse at center, rgba(6, 182, 212, 0.1) 0%, transparent 70%)',
                    }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                />
            )}
        </motion.div>
    );
}

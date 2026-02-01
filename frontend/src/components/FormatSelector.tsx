import { motion, AnimatePresence } from 'framer-motion';
import { Film, Music, ChevronDown } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { useState } from 'react';

const VIDEO_FORMATS = ['mp4', 'mkv', 'avi', 'webm'] as const;
const AUDIO_FORMATS = ['mp3', 'wav', 'flac', 'aac', 'opus'] as const;
const AUDIO_QUALITIES = ['320', '256', '192', '128'] as const;

export function FormatSelector() {
    const {
        formatType, setFormatType,
        quality, setQuality,
        videoInfo,
        videoFormat, setVideoFormat,
        audioFormat, setAudioFormat,
        audioQuality, setAudioQuality
    } = useAppStore();

    const [showVideoFormatDropdown, setShowVideoFormatDropdown] = useState(false);
    const [showAudioFormatDropdown, setShowAudioFormatDropdown] = useState(false);

    const videoQualities = ['best', '2160', '1440', '1080', '720', '480', '360'];
    const availableQualities = videoInfo
        ? videoQualities.filter(q =>
            q === 'best' || videoInfo.formats.some(f => f.resolution === `${q}p`)
        )
        : videoQualities;

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="space-y-4"
        >
            {/* Format Type Toggle */}
            <div>
                <label
                    className="text-xs uppercase tracking-widest text-gray-500 font-medium mb-2 block"
                    style={{ fontFamily: 'var(--font-mono)' }}
                >
                    Output Type
                </label>

                <div className="switch-track flex rounded-lg p-1 gap-1">
                    <button
                        onClick={() => setFormatType('video')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md transition-all ${formatType === 'video'
                            ? 'bg-terminal-green text-black font-semibold'
                            : 'text-gray-400 hover:text-white hover:bg-steel-grey'
                            }`}
                    >
                        <Film className="w-4 h-4" />
                        <span className="text-sm uppercase tracking-wider" style={{ fontFamily: 'var(--font-display)' }}>
                            Video
                        </span>
                        <span className="text-xs opacity-60">{videoFormat.toUpperCase()}</span>
                    </button>

                    <button
                        onClick={() => setFormatType('audio')}
                        className={`flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-md transition-all ${formatType === 'audio'
                            ? 'bg-terminal-green text-black font-semibold'
                            : 'text-gray-400 hover:text-white hover:bg-steel-grey'
                            }`}
                    >
                        <Music className="w-4 h-4" />
                        <span className="text-sm uppercase tracking-wider" style={{ fontFamily: 'var(--font-display)' }}>
                            Audio
                        </span>
                        <span className="text-xs opacity-60">{audioFormat.toUpperCase()}</span>
                    </button>
                </div>
            </div>

            {/* Video Options */}
            <AnimatePresence mode="wait">
                {formatType === 'video' && (
                    <motion.div
                        key="video-options"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                    >
                        {/* Video Format Dropdown */}
                        <div className="relative">
                            <label
                                className="text-xs uppercase tracking-widest text-gray-500 font-medium mb-2 block"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            >
                                Container Format
                            </label>
                            <button
                                onClick={() => setShowVideoFormatDropdown(!showVideoFormatDropdown)}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors"
                                style={{
                                    backgroundColor: 'var(--void-deep)',
                                    borderColor: 'var(--steel-grey)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--terminal-green)'}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--steel-grey)'}
                            >
                                <span className="text-white font-medium" style={{ fontFamily: 'var(--font-mono)' }}>
                                    {videoFormat.toUpperCase()}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showVideoFormatDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showVideoFormatDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden shadow-2xl"
                                        style={{
                                            backgroundColor: 'var(--void-deep)',
                                            border: '1px solid var(--steel-grey)',
                                            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8)'
                                        }}
                                    >
                                        {VIDEO_FORMATS.map((fmt) => (
                                            <button
                                                key={fmt}
                                                onClick={() => {
                                                    setVideoFormat(fmt);
                                                    setShowVideoFormatDropdown(false);
                                                }}
                                                className={`w-full px-4 py-2 text-left hover:bg-steel-grey transition-colors ${videoFormat === fmt ? 'bg-terminal-green/20 text-terminal-green' : 'text-white'
                                                    }`}
                                            >
                                                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt.toUpperCase()}</span>
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Resolution Selector */}
                        <div>
                            <label
                                className="text-xs uppercase tracking-widest text-gray-500 font-medium mb-2 block"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            >
                                Resolution
                            </label>

                            <div className="grid grid-cols-4 gap-2">
                                {availableQualities.map((q) => (
                                    <button
                                        key={q}
                                        onClick={() => setQuality(q)}
                                        className={`quality-option py-2 px-3 rounded text-center transition-all ${quality === q ? 'selected' : ''
                                            }`}
                                    >
                                        <span
                                            className="text-sm font-medium"
                                            style={{ fontFamily: 'var(--font-mono)' }}
                                        >
                                            {q === 'best' ? 'BEST' : `${q}p`}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Audio Options */}
                {formatType === 'audio' && (
                    <motion.div
                        key="audio-options"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="space-y-4"
                    >
                        {/* Audio Format Dropdown */}
                        <div className="relative">
                            <label
                                className="text-xs uppercase tracking-widest text-gray-500 font-medium mb-2 block"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            >
                                Audio Format
                            </label>
                            <button
                                onClick={() => setShowAudioFormatDropdown(!showAudioFormatDropdown)}
                                className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-colors"
                                style={{
                                    backgroundColor: 'var(--void-deep)',
                                    borderColor: 'var(--steel-grey)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--terminal-green)'}
                                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--steel-grey)'}
                            >
                                <span className="text-white font-medium" style={{ fontFamily: 'var(--font-mono)' }}>
                                    {audioFormat.toUpperCase()}
                                </span>
                                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${showAudioFormatDropdown ? 'rotate-180' : ''}`} />
                            </button>

                            <AnimatePresence>
                                {showAudioFormatDropdown && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -10 }}
                                        className="absolute z-10 w-full mt-1 rounded-lg overflow-hidden shadow-2xl"
                                        style={{
                                            backgroundColor: 'var(--void-deep)',
                                            border: '1px solid var(--steel-grey)',
                                            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.8)'
                                        }}
                                    >
                                        {AUDIO_FORMATS.map((fmt) => (
                                            <button
                                                key={fmt}
                                                onClick={() => {
                                                    setAudioFormat(fmt);
                                                    setShowAudioFormatDropdown(false);
                                                }}
                                                className={`w-full px-4 py-2 text-left hover:bg-steel-grey transition-colors ${audioFormat === fmt ? 'bg-terminal-green/20 text-terminal-green' : 'text-white'
                                                    }`}
                                            >
                                                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmt.toUpperCase()}</span>
                                            </button>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        {/* Audio Quality Selector */}
                        <div>
                            <label
                                className="text-xs uppercase tracking-widest text-gray-500 font-medium mb-2 block"
                                style={{ fontFamily: 'var(--font-mono)' }}
                            >
                                Bitrate
                            </label>

                            <div className="grid grid-cols-4 gap-2">
                                {AUDIO_QUALITIES.map((q) => (
                                    <button
                                        key={q}
                                        onClick={() => setAudioQuality(q)}
                                        className={`quality-option py-2 px-3 rounded text-center transition-all ${audioQuality === q ? 'selected' : ''
                                            }`}
                                    >
                                        <span
                                            className="text-sm font-medium"
                                            style={{ fontFamily: 'var(--font-mono)' }}
                                        >
                                            {q}k
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

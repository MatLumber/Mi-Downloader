import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud, FileVideo, FileAudio, FileImage } from 'lucide-react';
import type { DropKind } from '../../hooks/useFileDrop';
import { formatBytes, getFileName, shortenPath } from '../../lib/format';

interface DropZoneProps {
    isDragging: boolean;
    filePath: string;
    fileSize?: number | null;
    kind: DropKind;
    formats: string[];
    onPick: () => void;
    placeholderTitle?: string;
}

export function DropZone({
    isDragging,
    filePath,
    fileSize,
    kind,
    formats,
    onPick,
    placeholderTitle = 'Arrastra un archivo aquí',
}: DropZoneProps) {
    const Icon = kind === 'audio' ? FileAudio : kind === 'image' ? FileImage : FileVideo;

    if (filePath) {
        return (
            <button type="button" className="dropzone has-file" onClick={onPick}>
                <div className="dropzone-icon">
                    <Icon size={20} strokeWidth={1.7} />
                </div>
                <div className="file-card-text">
                    <span className="file-card-name">{getFileName(filePath)}</span>
                    <span className="file-card-path">{shortenPath(filePath, 4)}</span>
                </div>
                {fileSize ? <span className="file-card-size">{formatBytes(fileSize)}</span> : null}
            </button>
        );
    }

    return (
        <button
            type="button"
            onClick={onPick}
            className={`dropzone ${isDragging ? 'is-dragging' : ''}`}
        >
            <div className="dropzone-icon">
                <UploadCloud size={22} strokeWidth={1.7} />
            </div>
            <div>
                <div className="dropzone-title">{isDragging ? 'Suelta para cargar' : placeholderTitle}</div>
                <div className="dropzone-sub">o haz clic para elegir un archivo</div>
            </div>
            <div className="dropzone-formats">
                {formats.map((f) => (
                    <span key={f} className="dropzone-format">{f}</span>
                ))}
            </div>
        </button>
    );
}

export function GlobalDropOverlay({ visible, label }: { visible: boolean; label: string }) {
    return (
        <AnimatePresence>
            {visible && (
                <motion.div
                    className="global-drop"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                >
                    <motion.div
                        className="global-drop-inner"
                        initial={{ scale: 0.92, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.92, opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
                    >
                        <div className="global-drop-icon">
                            <UploadCloud size={32} strokeWidth={1.8} />
                        </div>
                        <div className="global-drop-title">Suelta el archivo</div>
                        <div className="global-drop-sub">{label}</div>
                    </motion.div>
                </motion.div>
            )}
        </AnimatePresence>
    );
}

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, ArrowDownAZ, ArrowUpAZ, Clock, Film, Music, Play, FolderOpen, Trash2, History as HistoryIcon } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import type { CompletedDownload, SortDir } from '../../store/useAppStore';
import { formatRelativeTime, formatExactTime } from '../../lib/format';
import { resolveThumbnail, getPlatformIcon } from '../../lib/platforms';

const SORT_LABELS: Record<SortDir, { label: string; icon: typeof Clock }> = {
    newest: { label: 'Más nuevo', icon: Clock },
    oldest: { label: 'Más antiguo', icon: Clock },
    'a-z': { label: 'A → Z', icon: ArrowDownAZ },
    'z-a': { label: 'Z → A', icon: ArrowUpAZ },
};

const SORT_ORDER: SortDir[] = ['newest', 'oldest', 'a-z', 'z-a'];

export function HistoryView() {
    const {
        videoHistory, audioHistory,
        historyKind, setHistoryKind,
        historySort, setHistorySort,
        historySearch, setHistorySearch,
        clearHistory, removeFromHistory,
    } = useAppStore();

    const list = useMemo(() => {
        let combined: CompletedDownload[] = [];
        if (historyKind === 'all') combined = [...videoHistory, ...audioHistory];
        else if (historyKind === 'video') combined = videoHistory;
        else combined = audioHistory;

        if (historySearch.trim()) {
            const q = historySearch.toLowerCase();
            combined = combined.filter((item) =>
                item.title.toLowerCase().includes(q) ||
                item.filename.toLowerCase().includes(q) ||
                (item.platform || '').toLowerCase().includes(q),
            );
        }

        combined.sort((a, b) => {
            switch (historySort) {
                case 'newest': return new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime();
                case 'oldest': return new Date(a.completed_at).getTime() - new Date(b.completed_at).getTime();
                case 'a-z': return a.title.localeCompare(b.title);
                case 'z-a': return b.title.localeCompare(a.title);
            }
        });

        return combined;
    }, [videoHistory, audioHistory, historyKind, historySort, historySearch]);

    const totalSize = useMemo(
        () => [...videoHistory, ...audioHistory].reduce((sum, item) => sum + (item.filesize || 0), 0),
        [videoHistory, audioHistory],
    );

    const cycleSort = () => {
        const idx = SORT_ORDER.indexOf(historySort);
        setHistorySort(SORT_ORDER[(idx + 1) % SORT_ORDER.length]);
    };

    const SortIcon = SORT_LABELS[historySort].icon;

    return (
        <div className="content-inner">
            <header className="page-header">
                <div className="page-eyebrow">Historial</div>
                <h1 className="page-title">Tus descargas</h1>
                <p className="page-subtitle">Todo lo que has bajado, ordenado y filtrable. Persistente entre sesiones.</p>
            </header>

            <div className="stat-grid">
                <div className="stat-tile">
                    <div className="stat-label">Videos</div>
                    <div className="stat-value">{videoHistory.length}</div>
                    <div className="stat-sub">archivos guardados</div>
                </div>
                <div className="stat-tile">
                    <div className="stat-label">Audios</div>
                    <div className="stat-value">{audioHistory.length}</div>
                    <div className="stat-sub">extracciones</div>
                </div>
                <div className="stat-tile">
                    <div className="stat-label">Total</div>
                    <div className="stat-value">{videoHistory.length + audioHistory.length}</div>
                    <div className="stat-sub">descargas completas</div>
                </div>
                {totalSize > 0 && (
                    <div className="stat-tile">
                        <div className="stat-label">Tamaño</div>
                        <div className="stat-value">{(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB</div>
                        <div className="stat-sub">acumulado</div>
                    </div>
                )}
            </div>

            <div className="toolbar">
                <div className="seg">
                    {(['all', 'video', 'audio'] as const).map((k) => (
                        <button
                            key={k}
                            className={`seg-item ${historyKind === k ? 'is-active' : ''}`}
                            onClick={() => setHistoryKind(k)}
                        >
                            {k === 'all' ? 'Todos' : k === 'video' ? <Film size={13} /> : <Music size={13} />}
                            <span>{k === 'all' ? '' : k === 'video' ? 'Videos' : 'Audios'}</span>
                            <span className="seg-count">
                                {k === 'all' ? videoHistory.length + audioHistory.length : k === 'video' ? videoHistory.length : audioHistory.length}
                            </span>
                        </button>
                    ))}
                </div>

                <div className="search-wrap">
                    <span className="search-wrap-icon">
                        <Search size={15} strokeWidth={1.9} />
                    </span>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Buscar por título, archivo o plataforma…"
                        value={historySearch}
                        onChange={(e) => setHistorySearch(e.target.value)}
                    />
                </div>

                <button className="sort-pill" onClick={cycleSort} title="Cambiar orden">
                    <SortIcon size={13} strokeWidth={1.7} />
                    <span>{SORT_LABELS[historySort].label}</span>
                </button>

                {(videoHistory.length + audioHistory.length) > 0 && (
                    <button className="btn btn-ghost" onClick={clearHistory}>
                        <Trash2 size={13} />
                        <span>Vaciar</span>
                    </button>
                )}
            </div>

            {list.length === 0 ? (
                <div className="surface empty">
                    <div className="empty-mark">
                        <HistoryIcon size={22} strokeWidth={1.6} />
                    </div>
                    <div className="empty-title">
                        {historySearch ? 'Sin resultados' : 'Aún no hay nada guardado'}
                    </div>
                    <div className="empty-sub">
                        {historySearch
                            ? `No encontramos coincidencias para "${historySearch}".`
                            : 'Las descargas que completes aparecerán aquí. Se guardan localmente entre sesiones.'}
                    </div>
                </div>
            ) : (
                <div className="history-list">
                    <AnimatePresence mode="popLayout">
                        {list.map((item) => (
                            <motion.div
                                key={item.id}
                                layout
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                className="history-item"
                            >
                                <div className="history-thumb">
                                    {item.thumbnail ? (
                                        <img src={resolveThumbnail(item.thumbnail, item.platform)} alt="" />
                                    ) : item.format_type === 'video' ? (
                                        <Film size={16} />
                                    ) : (
                                        <Music size={16} />
                                    )}
                                </div>
                                <div className="history-info">
                                    <div className="history-title" title={item.title}>{item.title}</div>
                                    <div className="history-meta">
                                        <span className="format-tag">{item.format}</span>
                                        {item.platform && (
                                            <>
                                                <span style={{ display: 'inline-flex' }}>{getPlatformIcon(item.platform, 11)}</span>
                                            </>
                                        )}
                                        {item.filesize > 0 && <span>{(item.filesize / 1024 / 1024).toFixed(1)} MB</span>}
                                    </div>
                                </div>
                                <span className="history-date" title={formatExactTime(item.completed_at)}>
                                    {formatRelativeTime(item.completed_at)}
                                </span>
                                <div className="history-actions">
                                    <button className="btn-icon" onClick={() => item.filepath && window.electronAPI?.openPath(item.filepath)} title="Abrir">
                                        <Play size={14} strokeWidth={1.8} />
                                    </button>
                                    <button className="btn-icon" onClick={() => item.filepath && window.electronAPI?.showItemInFolder(item.filepath)} title="Mostrar en carpeta">
                                        <FolderOpen size={14} strokeWidth={1.8} />
                                    </button>
                                    <button className="btn-icon is-danger" onClick={() => removeFromHistory(item.id)} title="Quitar">
                                        <Trash2 size={14} strokeWidth={1.8} />
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            )}
        </div>
    );
}

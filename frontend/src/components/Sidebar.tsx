import { Download, Layers, Repeat, History, Settings as SettingsIcon } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import type { ActiveTab } from '../store/useAppStore';

interface NavEntry {
    id: ActiveTab;
    label: string;
    icon: typeof Download;
}

const TOP_NAV: NavEntry[] = [
    { id: 'queue', label: 'Descargar', icon: Download },
    { id: 'compress', label: 'Comprimir', icon: Layers },
    { id: 'convert', label: 'Convertir', icon: Repeat },
    { id: 'history', label: 'Historial', icon: History },
];

const BOTTOM_NAV: NavEntry[] = [
    { id: 'settings', label: 'Ajustes', icon: SettingsIcon },
];

export function Sidebar() {
    const activeTab = useAppStore((s) => s.activeTab);
    const setActiveTab = useAppStore((s) => s.setActiveTab);
    const queue = useAppStore((s) => s.downloadQueue);
    const activeCount = queue.filter((t) => ['queued', 'fetching_info', 'downloading', 'processing'].includes(t.status)).length;

    return (
        <nav className="sidebar" aria-label="Navegación principal">
            <div className="sidebar-section">
                {TOP_NAV.map((entry) => {
                    const Icon = entry.icon;
                    const isActive = activeTab === entry.id;
                    const showBadge = entry.id === 'queue' && activeCount > 0;
                    return (
                        <button
                            key={entry.id}
                            onClick={() => setActiveTab(entry.id)}
                            className={`nav-item ${isActive ? 'is-active' : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={entry.label}
                        >
                            <Icon size={19} strokeWidth={1.7} />
                            {showBadge && <span className="nav-badge">{activeCount}</span>}
                            <span className="nav-item-tooltip">{entry.label}</span>
                        </button>
                    );
                })}
            </div>

            <div className="sidebar-spacer" />

            <div className="sidebar-section">
                <div className="sidebar-divider" />
                {BOTTOM_NAV.map((entry) => {
                    const Icon = entry.icon;
                    const isActive = activeTab === entry.id;
                    return (
                        <button
                            key={entry.id}
                            onClick={() => setActiveTab(entry.id)}
                            className={`nav-item ${isActive ? 'is-active' : ''}`}
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={entry.label}
                        >
                            <Icon size={19} strokeWidth={1.7} />
                            <span className="nav-item-tooltip">{entry.label}</span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}

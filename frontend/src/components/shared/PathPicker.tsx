import { Folder } from 'lucide-react';
import { shortenPath } from '../../lib/format';

interface PathPickerProps {
    label: string;
    value: string;
    onPick: () => void;
    disabled?: boolean;
}

export function PathPicker({ label, value, onPick, disabled }: PathPickerProps) {
    return (
        <button
            type="button"
            onClick={onPick}
            className="pathpicker"
            disabled={disabled}
        >
            <div className="pathpicker-icon">
                <Folder size={16} strokeWidth={1.8} />
            </div>
            <div className="pathpicker-info">
                <span className="pathpicker-label">{label}</span>
                <span className="pathpicker-value" title={value}>{shortenPath(value, 4) || 'Sin definir'}</span>
            </div>
            <span className="pathpicker-action">Cambiar</span>
        </button>
    );
}

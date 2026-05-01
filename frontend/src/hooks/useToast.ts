import { useContext } from 'react';
import { ToastContext } from '../components/shared/ToastContext';
import type { ToastContextValue } from '../components/shared/ToastContext';

export function useToast(): ToastContextValue {
    const ctx = useContext(ToastContext);
    if (!ctx) {
        return { push: () => { } };
    }
    return ctx;
}

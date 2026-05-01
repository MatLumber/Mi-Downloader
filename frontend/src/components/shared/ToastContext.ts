import { createContext } from 'react';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastContextValue {
    push: (variant: ToastVariant, title: string, message?: string, duration?: number) => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

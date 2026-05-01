import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { ToastContext } from './ToastContext';
import type { ToastContextValue, ToastVariant } from './ToastContext';

interface Toast {
    id: string;
    variant: ToastVariant;
    title: string;
    message?: string;
    duration: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const push = useCallback<ToastContextValue['push']>((variant, title, message, duration = 4500) => {
        const id = crypto.randomUUID();
        setToasts((prev) => [...prev, { id, variant, title, message, duration }]);
    }, []);

    const dismiss = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ push }}>
            {children}
            <div className="toast-stack" aria-live="polite">
                <AnimatePresence>
                    {toasts.map((toast) => (
                        <ToastItem key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />
                    ))}
                </AnimatePresence>
            </div>
        </ToastContext.Provider>
    );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    useEffect(() => {
        const timer = window.setTimeout(onDismiss, toast.duration);
        return () => window.clearTimeout(timer);
    }, [toast.duration, onDismiss]);

    const Icon = toast.variant === 'success' ? CheckCircle2 : toast.variant === 'error' ? AlertTriangle : Info;
    const variantClass = toast.variant === 'success' ? 'is-success' : toast.variant === 'error' ? 'is-error' : 'is-info';

    return (
        <motion.div
            layout
            className={`toast ${variantClass}`}
            initial={{ opacity: 0, x: 40, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
        >
            <div className="toast-icon">
                <Icon size={16} strokeWidth={2} />
            </div>
            <div className="toast-body">
                <div className="toast-title">{toast.title}</div>
                {toast.message && <div className="toast-msg">{toast.message}</div>}
            </div>
            <button className="btn-icon" onClick={onDismiss} aria-label="Cerrar">
                <X size={14} />
            </button>
        </motion.div>
    );
}

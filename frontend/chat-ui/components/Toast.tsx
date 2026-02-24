'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  success: (title: string, message?: string, duration?: number) => string;
  error: (title: string, message?: string, duration?: number) => string;
  warning: (title: string, message?: string, duration?: number) => string;
  info: (title: string, message?: string, duration?: number) => string;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 11);
    const newToast: Toast = {
      id,
      ...toast,
      duration: toast.duration ?? 5000
    };

    setToasts(prev => [...prev, newToast]);

    // Auto-remove after duration
    if (newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.duration);
    }

    return id;
  }, [removeToast]);

  const success = useCallback(
    (title: string, message?: string, duration?: number) => {
      return addToast({ type: 'success', title, message, duration });
    },
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string, duration?: number) => {
      return addToast({ type: 'error', title, message, duration: duration ?? 0 }); // Errors don't auto-dismiss
    },
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string, duration?: number) => {
      return addToast({ type: 'warning', title, message, duration });
    },
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string, duration?: number) => {
      return addToast({ type: 'info', title, message, duration });
    },
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Announce to screen readers
    const announcement = document.createElement('div');
    announcement.setAttribute('role', toast.type === 'error' ? 'alert' : 'status');
    announcement.setAttribute('aria-live', toast.type === 'error' ? 'assertive' : 'polite');
    announcement.className = 'sr-only';
    announcement.textContent = `${toast.title}. ${toast.message || ''}`;
    document.body.appendChild(announcement);

    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }, [toast]);

  const handleRemove = () => {
    setIsExiting(true);
    setTimeout(() => {
      onRemove(toast.id);
    }, 300);
  };

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'info':
        return <Info className="h-5 w-5 text-blue-500" />;
    }
  };

  const getStyles = () => {
    const base = 'bg-white dark:bg-gray-800 shadow-lg rounded-lg border';
    switch (toast.type) {
      case 'success':
        return `${base} border-green-200 dark:border-green-800`;
      case 'error':
        return `${base} border-red-200 dark:border-red-800`;
      case 'warning':
        return `${base} border-yellow-200 dark:border-yellow-800`;
      case 'info':
        return `${base} border-blue-200 dark:border-blue-800`;
    }
  };

  return (
    <div
      className={`${getStyles()} p-4 transition-all duration-300 ${
        isExiting ? 'opacity-0 translate-x-8' : 'opacity-100 translate-x-0'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{toast.title}</p>
          {toast.message && (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{toast.message}</p>
          )}

          {toast.action && (
            <button
              onClick={() => {
                toast.action!.onClick();
                handleRemove();
              }}
              className="mt-2 text-sm font-medium text-blue-600 dark:text-blue-400
                       hover:text-blue-700 dark:hover:text-blue-300"
            >
              {toast.action.label}
            </button>
          )}
        </div>

        <button
          onClick={handleRemove}
          className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          aria-label="Dismiss notification"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

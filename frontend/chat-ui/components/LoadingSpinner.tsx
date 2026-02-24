'use client';

import { Loader2 } from 'lucide-react';
import { ReactNode } from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  fullScreen?: boolean;
  className?: string;
}

export function LoadingSpinner({ size = 'md', text, fullScreen, className }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12'
  };

  const spinner = (
    <div className={`flex flex-col items-center justify-center gap-3 ${className || ''}`}>
      <Loader2 className={`${sizeClasses[size]} animate-spin text-primary`} />
      {text && <p className="text-sm text-gray-600">{text}</p>}
    </div>
  );

  if (fullScreen) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        {spinner}
      </div>
    );
  }

  return spinner;
}

interface LoadingOverlayProps {
  isLoading: boolean;
  children: ReactNode;
  text?: string;
}

export function LoadingOverlay({ isLoading, children, text }: LoadingOverlayProps) {
  return (
    <div className="relative">
      {children}
      {isLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <LoadingSpinner text={text} />
        </div>
      )}
    </div>
  );
}

interface LoadingButtonProps {
  isLoading: boolean;
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
}

export function LoadingButton({
  isLoading,
  children,
  onClick,
  disabled,
  className,
  type = 'button'
}: LoadingButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${className || ''}`}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

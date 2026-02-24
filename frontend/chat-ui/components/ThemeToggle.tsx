'use client';

import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme, Theme } from '../contexts/ThemeContext';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const cycleTheme = () => {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const getIcon = () => {
    if (theme === 'system') {
      return <Monitor className="h-5 w-5" />;
    }
    return resolvedTheme === 'dark' ? (
      <Moon className="h-5 w-5" />
    ) : (
      <Sun className="h-5 w-5" />
    );
  };

  const getLabel = () => {
    if (theme === 'system') {
      return `System (${resolvedTheme})`;
    }
    return theme === 'dark' ? 'Dark' : 'Light';
  };

  return (
    <button
      onClick={cycleTheme}
      className={`inline-flex items-center gap-2 px-3 py-2 rounded-md
                 bg-gray-100 dark:bg-gray-800
                 hover:bg-gray-200 dark:hover:bg-gray-700
                 transition-colors ${className}`}
      aria-label={`Current theme: ${getLabel()}. Click to cycle themes.`}
      title={`Theme: ${getLabel()}`}
    >
      {getIcon()}
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
        {getLabel()}
      </span>
    </button>
  );
}

export function ThemeToggleCompact({ className = '' }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  const cycleTheme = () => {
    const themes: Theme[] = ['light', 'dark', 'system'];
    const currentIndex = themes.indexOf(theme);
    const nextIndex = (currentIndex + 1) % themes.length;
    setTheme(themes[nextIndex]);
  };

  const getIcon = () => {
    if (theme === 'system') {
      return <Monitor className="h-5 w-5" />;
    }
    return resolvedTheme === 'dark' ? (
      <Moon className="h-5 w-5" />
    ) : (
      <Sun className="h-5 w-5" />
    );
  };

  const getLabel = () => {
    if (theme === 'system') {
      return `System theme (currently ${resolvedTheme})`;
    }
    return theme === 'dark' ? 'Dark theme' : 'Light theme';
  };

  return (
    <button
      onClick={cycleTheme}
      className={`p-2 rounded-md
                 bg-gray-100 dark:bg-gray-800
                 hover:bg-gray-200 dark:hover:bg-gray-700
                 transition-colors ${className}`}
      aria-label={getLabel()}
      title={getLabel()}
    >
      {getIcon()}
    </button>
  );
}

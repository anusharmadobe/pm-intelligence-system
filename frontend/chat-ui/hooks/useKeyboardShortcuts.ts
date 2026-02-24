'use client';

import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean; // Cmd on Mac, Windows key on Windows
  description: string;
  action: () => void;
  preventDefault?: boolean;
  enabled?: boolean;
}

export interface ShortcutGroup {
  name: string;
  shortcuts: KeyboardShortcut[];
}

/**
 * Hook to register keyboard shortcuts
 */
export function useKeyboardShortcuts(shortcuts: KeyboardShortcut[], enabled: boolean = true) {
  const shortcutsRef = useRef(shortcuts);

  // Update ref when shortcuts change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
  }, [shortcuts]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      for (const shortcut of shortcutsRef.current) {
        // Skip if shortcut is disabled
        if (shortcut.enabled === false) continue;

        // Check if all modifiers match
        const modifiersMatch =
          (shortcut.ctrl === undefined || event.ctrlKey === shortcut.ctrl) &&
          (shortcut.shift === undefined || event.shiftKey === shortcut.shift) &&
          (shortcut.alt === undefined || event.altKey === shortcut.alt) &&
          (shortcut.meta === undefined || event.metaKey === shortcut.meta);

        // Check if key matches (case-insensitive)
        const keyMatches = event.key.toLowerCase() === shortcut.key.toLowerCase();

        if (modifiersMatch && keyMatches) {
          // Don't trigger if user is typing in an input
          const target = event.target as HTMLElement;
          const isTyping =
            target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.isContentEditable;

          if (!isTyping) {
            if (shortcut.preventDefault !== false) {
              event.preventDefault();
            }
            shortcut.action();
            break; // Only trigger first matching shortcut
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled]);
}

/**
 * Hook to register global app shortcuts
 */
export function useGlobalShortcuts(
  shortcuts: {
    onSearch?: () => void;
    onHelp?: () => void;
    onNewItem?: () => void;
    onSave?: () => void;
    onClose?: () => void;
    onRefresh?: () => void;
    onToggleSidebar?: () => void;
    onToggleTheme?: () => void;
  },
  enabled: boolean = true
) {
  const shortcutList: KeyboardShortcut[] = [];

  if (shortcuts.onSearch) {
    shortcutList.push({
      key: 'k',
      ctrl: true,
      description: 'Open search',
      action: shortcuts.onSearch
    });
    shortcutList.push({
      key: '/',
      description: 'Focus search',
      action: shortcuts.onSearch
    });
  }

  if (shortcuts.onHelp) {
    shortcutList.push({
      key: '?',
      shift: true,
      description: 'Show help',
      action: shortcuts.onHelp
    });
  }

  if (shortcuts.onNewItem) {
    shortcutList.push({
      key: 'n',
      ctrl: true,
      description: 'Create new item',
      action: shortcuts.onNewItem
    });
  }

  if (shortcuts.onSave) {
    shortcutList.push({
      key: 's',
      ctrl: true,
      description: 'Save',
      action: shortcuts.onSave
    });
  }

  if (shortcuts.onClose) {
    shortcutList.push({
      key: 'Escape',
      description: 'Close/Cancel',
      action: shortcuts.onClose
    });
  }

  if (shortcuts.onRefresh) {
    shortcutList.push({
      key: 'r',
      ctrl: true,
      description: 'Refresh',
      action: shortcuts.onRefresh
    });
  }

  if (shortcuts.onToggleSidebar) {
    shortcutList.push({
      key: 'b',
      ctrl: true,
      description: 'Toggle sidebar',
      action: shortcuts.onToggleSidebar
    });
  }

  if (shortcuts.onToggleTheme) {
    shortcutList.push({
      key: 'd',
      ctrl: true,
      shift: true,
      description: 'Toggle dark mode',
      action: shortcuts.onToggleTheme
    });
  }

  useKeyboardShortcuts(shortcutList, enabled);
}

/**
 * Format shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  // Detect OS for proper modifier key display
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

  if (shortcut.ctrl) parts.push(isMac ? '⌃' : 'Ctrl');
  if (shortcut.alt) parts.push(isMac ? '⌥' : 'Alt');
  if (shortcut.shift) parts.push(isMac ? '⇧' : 'Shift');
  if (shortcut.meta) parts.push(isMac ? '⌘' : 'Win');

  // Format key name
  let keyName = shortcut.key;
  const specialKeys: Record<string, string> = {
    Escape: 'Esc',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: '↵',
    Backspace: '⌫',
    Delete: 'Del',
    ' ': 'Space'
  };

  keyName = specialKeys[keyName] || keyName.toUpperCase();
  parts.push(keyName);

  return parts.join(isMac ? '' : '+');
}

/**
 * Get default keyboard shortcuts for the app
 */
export function getDefaultShortcuts(): ShortcutGroup[] {
  return [
    {
      name: 'Navigation',
      shortcuts: [
        {
          key: 'k',
          ctrl: true,
          description: 'Open search',
          action: () => {}
        },
        {
          key: '/',
          description: 'Focus search',
          action: () => {}
        },
        {
          key: 'b',
          ctrl: true,
          description: 'Toggle sidebar',
          action: () => {}
        },
        {
          key: '?',
          shift: true,
          description: 'Show keyboard shortcuts',
          action: () => {}
        }
      ]
    },
    {
      name: 'Actions',
      shortcuts: [
        {
          key: 'n',
          ctrl: true,
          description: 'Create new item',
          action: () => {}
        },
        {
          key: 's',
          ctrl: true,
          description: 'Save',
          action: () => {}
        },
        {
          key: 'r',
          ctrl: true,
          description: 'Refresh',
          action: () => {}
        },
        {
          key: 'e',
          ctrl: true,
          description: 'Export',
          action: () => {}
        }
      ]
    },
    {
      name: 'Interface',
      shortcuts: [
        {
          key: 'd',
          ctrl: true,
          shift: true,
          description: 'Toggle dark mode',
          action: () => {}
        },
        {
          key: 'Escape',
          description: 'Close modal/dialog',
          action: () => {}
        }
      ]
    }
  ];
}

/**
 * Component to display keyboard shortcuts modal
 */
export function ShortcutsModal({
  shortcuts,
  onClose
}: {
  shortcuts: ShortcutGroup[];
  onClose: () => void;
}) {
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Keyboard Shortcuts</h2>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>

          <div className="space-y-6">
            {shortcuts.map((group) => (
              <div key={group.name}>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-3">{group.name}</h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut, index) => (
                    <div key={index} className="flex items-center justify-between py-2">
                      <span className="text-gray-700 dark:text-gray-300">{shortcut.description}</span>
                      <kbd className="px-3 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-mono text-gray-900 dark:text-white">
                        {formatShortcut(shortcut)}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

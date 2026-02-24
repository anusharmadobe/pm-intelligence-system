/**
 * Accessibility Utilities
 *
 * Helpers for WCAG 2.1 compliance and accessible UI patterns
 */

/**
 * Generate accessible ID for form field
 */
export function generateA11yId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Announce message to screen readers
 */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite') {
  if (typeof document === 'undefined') return;

  const announcement = document.createElement('div');
  announcement.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
  announcement.setAttribute('aria-live', priority);
  announcement.setAttribute('aria-atomic', 'true');
  announcement.className = 'sr-only';
  announcement.textContent = message;

  document.body.appendChild(announcement);

  // Remove after announcement
  setTimeout(() => {
    document.body.removeChild(announcement);
  }, 1000);
}

/**
 * Check if element is focusable
 */
export function isFocusable(element: HTMLElement): boolean {
  if (element.tabIndex < 0) return false;
  if (element.hasAttribute('disabled')) return false;
  if (element.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden') return false;

  return true;
}

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
  ].join(', ');

  const elements = Array.from(container.querySelectorAll<HTMLElement>(selector));

  return elements.filter(isFocusable);
}

/**
 * Trap focus within a container (for modals, dialogs)
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableElements = getFocusableElements(container);
  if (focusableElements.length === 0) return () => {};

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    if (e.shiftKey) {
      // Shift + Tab
      if (document.activeElement === firstElement) {
        e.preventDefault();
        lastElement.focus();
      }
    } else {
      // Tab
      if (document.activeElement === lastElement) {
        e.preventDefault();
        firstElement.focus();
      }
    }
  };

  container.addEventListener('keydown', handleKeyDown);

  // Focus first element
  firstElement.focus();

  // Return cleanup function
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Check color contrast ratio (WCAG AA requires 4.5:1 for normal text)
 */
export function getContrastRatio(foreground: string, background: string): number {
  const getLuminance = (color: string): number => {
    const rgb = hexToRgb(color);
    if (!rgb) return 0;

    const [r, g, b] = [rgb.r, rgb.g, rgb.b].map((c) => {
      const channel = c / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  const l1 = getLuminance(foreground);
  const l2 = getLuminance(background);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      }
    : null;
}

/**
 * Check if contrast meets WCAG AA standard
 */
export function meetsWCAGAA(foreground: string, background: string, largeText: boolean = false): boolean {
  const ratio = getContrastRatio(foreground, background);
  return largeText ? ratio >= 3 : ratio >= 4.5;
}

/**
 * Check if contrast meets WCAG AAA standard
 */
export function meetsWCAGAAA(foreground: string, background: string, largeText: boolean = false): boolean {
  const ratio = getContrastRatio(foreground, background);
  return largeText ? ratio >= 4.5 : ratio >= 7;
}

/**
 * Generate ARIA label for pagination
 */
export function getPaginationAriaLabel(current: number, total: number): string {
  return `Page ${current} of ${total}`;
}

/**
 * Generate ARIA label for sort button
 */
export function getSortAriaLabel(column: string, direction: 'asc' | 'desc' | null): string {
  if (!direction) {
    return `Sort by ${column}`;
  }
  return `Sorted by ${column} ${direction === 'asc' ? 'ascending' : 'descending'}. Click to sort ${
    direction === 'asc' ? 'descending' : 'ascending'
  }.`;
}

/**
 * Generate ARIA label for loading state
 */
export function getLoadingAriaLabel(message: string = 'Loading'): string {
  return `${message}. Please wait.`;
}

/**
 * Create skip link for keyboard navigation
 */
export function createSkipLink(targetId: string, label: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `#${targetId}`;
  link.textContent = label;
  link.className = 'sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded';
  return link;
}

/**
 * Manage focus for route changes
 */
export function manageFocusOnRouteChange(targetId?: string) {
  // Focus on main content or specified element after route change
  const target = targetId ? document.getElementById(targetId) : document.getElementById('main-content');

  if (target) {
    // Make temporarily focusable if not naturally focusable
    const originalTabIndex = target.getAttribute('tabindex');
    target.setAttribute('tabindex', '-1');
    target.focus();

    // Restore original tabindex after focus
    if (originalTabIndex === null) {
      target.removeAttribute('tabindex');
    } else {
      target.setAttribute('tabindex', originalTabIndex);
    }
  }
}

/**
 * Add live region for dynamic content
 */
export function createLiveRegion(priority: 'polite' | 'assertive' = 'polite'): HTMLDivElement {
  const region = document.createElement('div');
  region.setAttribute('role', priority === 'assertive' ? 'alert' : 'status');
  region.setAttribute('aria-live', priority);
  region.setAttribute('aria-atomic', 'true');
  region.className = 'sr-only';
  return region;
}

/**
 * Format number for screen readers
 */
export function formatNumberForA11y(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)} million`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)} thousand`;
  }
  return num.toString();
}

/**
 * Format date for screen readers
 */
export function formatDateForA11y(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Generate progress bar ARIA attributes
 */
export function getProgressAriaAttributes(current: number, max: number, label?: string) {
  const percentage = Math.round((current / max) * 100);

  return {
    role: 'progressbar',
    'aria-valuenow': current,
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-valuetext': `${percentage}% complete`,
    'aria-label': label || 'Progress'
  };
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Safely focus element with error handling
 */
export function safeFocus(element: HTMLElement | null) {
  if (!element) return;

  try {
    element.focus();
  } catch (error) {
    console.warn('Failed to focus element:', error);
  }
}

/**
 * Browser Compatibility Checks
 *
 * Detects browser features and provides fallbacks/warnings
 */

export interface BrowserCompatibility {
  isSupported: boolean;
  missing: string[];
  warnings: string[];
  browserInfo: {
    name: string;
    version: string;
    isMobile: boolean;
  };
}

/**
 * Check if browser supports required features
 */
export function checkBrowserCompatibility(): BrowserCompatibility {
  const missing: string[] = [];
  const warnings: string[] = [];

  // Required features
  if (typeof fetch === 'undefined') {
    missing.push('Fetch API');
  }

  if (typeof Promise === 'undefined') {
    missing.push('Promises');
  }

  if (typeof localStorage === 'undefined' && typeof window !== 'undefined') {
    missing.push('LocalStorage');
  }

  if (typeof EventSource === 'undefined') {
    warnings.push('Server-Sent Events (SSE) not supported - real-time updates disabled');
  }

  // Optional but recommended features
  if (typeof IntersectionObserver === 'undefined') {
    warnings.push('IntersectionObserver not supported - lazy loading disabled');
  }

  if (typeof ResizeObserver === 'undefined') {
    warnings.push('ResizeObserver not supported - responsive layouts may not work optimally');
  }

  const browserInfo = detectBrowser();

  return {
    isSupported: missing.length === 0,
    missing,
    warnings,
    browserInfo
  };
}

/**
 * Detect browser name and version
 */
function detectBrowser(): { name: string; version: string; isMobile: boolean } {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { name: 'Unknown', version: 'Unknown', isMobile: false };
  }

  const ua = navigator.userAgent;
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);

  // Chrome
  if (/Chrome\/(\d+)/.test(ua) && !/Edge/.test(ua)) {
    const match = ua.match(/Chrome\/(\d+)/);
    return { name: 'Chrome', version: match ? match[1] : 'Unknown', isMobile };
  }

  // Safari
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
    const match = ua.match(/Version\/(\d+)/);
    return { name: 'Safari', version: match ? match[1] : 'Unknown', isMobile };
  }

  // Firefox
  if (/Firefox\/(\d+)/.test(ua)) {
    const match = ua.match(/Firefox\/(\d+)/);
    return { name: 'Firefox', version: match ? match[1] : 'Unknown', isMobile };
  }

  // Edge
  if (/Edg\/(\d+)/.test(ua)) {
    const match = ua.match(/Edg\/(\d+)/);
    return { name: 'Edge', version: match ? match[1] : 'Unknown', isMobile };
  }

  return { name: 'Unknown', version: 'Unknown', isMobile };
}

/**
 * Check if browser is outdated
 */
export function isOutdatedBrowser(): boolean {
  const compat = checkBrowserCompatibility();
  const { name, version } = compat.browserInfo;
  const versionNum = parseInt(version, 10);

  if (isNaN(versionNum)) return false;

  // Minimum supported versions
  const minimumVersions: Record<string, number> = {
    Chrome: 90,
    Safari: 14,
    Firefox: 88,
    Edge: 90
  };

  const minVersion = minimumVersions[name];
  if (!minVersion) return false;

  return versionNum < minVersion;
}

/**
 * Get user-friendly browser compatibility message
 */
export function getCompatibilityMessage(compat: BrowserCompatibility): string | null {
  if (compat.isSupported) {
    if (compat.warnings.length > 0) {
      return `Your browser is supported, but some features may be limited: ${compat.warnings.join(', ')}`;
    }
    return null;
  }

  return `Your browser is missing required features: ${compat.missing.join(', ')}. Please upgrade to a modern browser (Chrome 90+, Safari 14+, Firefox 88+, Edge 90+).`;
}

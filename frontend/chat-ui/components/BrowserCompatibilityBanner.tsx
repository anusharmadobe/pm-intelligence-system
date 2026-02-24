'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { checkBrowserCompatibility, getCompatibilityMessage, isOutdatedBrowser } from '@/lib/browser-compat';

export function BrowserCompatibilityBanner() {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    const compat = checkBrowserCompatibility();
    const compatMessage = getCompatibilityMessage(compat);
    const outdated = isOutdatedBrowser();

    if (compatMessage) {
      setMessage(compatMessage);
      setIsError(!compat.isSupported);
      setShow(true);
    } else if (outdated) {
      setMessage(
        `You're using an outdated version of ${compat.browserInfo.name}. For the best experience, please update your browser.`
      );
      setIsError(false);
      setShow(true);
    }
  }, []);

  if (!show || !message) {
    return null;
  }

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 ${
        isError ? 'bg-red-600' : 'bg-yellow-600'
      } text-white px-4 py-3 shadow-lg`}
    >
      <div className="container mx-auto flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">{message}</p>
        </div>
        <button
          onClick={() => setShow(false)}
          className="flex-shrink-0 rounded p-1 hover:bg-white/20 transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

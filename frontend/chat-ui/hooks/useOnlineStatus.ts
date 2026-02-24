'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect online/offline status
 *
 * Returns true when online, false when offline
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    // Set initial status
    if (typeof navigator !== 'undefined' && typeof navigator.onLine !== 'undefined') {
      setIsOnline(navigator.onLine);
    }

    // Listen for online/offline events
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Hook to get detailed network information
 */
export function useNetworkInformation(): {
  isOnline: boolean;
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
} {
  const isOnline = useOnlineStatus();
  const [networkInfo, setNetworkInfo] = useState<any>({});

  useEffect(() => {
    // Check for Network Information API
    const connection =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;

    if (!connection) {
      return;
    }

    const updateNetworkInfo = () => {
      setNetworkInfo({
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt,
        saveData: connection.saveData
      });
    };

    updateNetworkInfo();

    connection.addEventListener('change', updateNetworkInfo);

    return () => {
      connection.removeEventListener('change', updateNetworkInfo);
    };
  }, []);

  return { isOnline, ...networkInfo };
}

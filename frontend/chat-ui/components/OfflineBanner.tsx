'use client';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { WifiOff, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  const [showReconnected, setShowReconnected] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setWasOffline(true);
      setShowReconnected(false);
    } else if (wasOffline) {
      // Show "reconnected" message briefly
      setShowReconnected(true);
      const timer = setTimeout(() => {
        setShowReconnected(false);
        setWasOffline(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline]);

  if (isOnline && !showReconnected) {
    return null;
  }

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-50 ${
        isOnline ? 'bg-green-600' : 'bg-gray-800'
      } text-white px-4 py-2 shadow-lg transition-all duration-300`}
    >
      <div className="container mx-auto flex items-center justify-center gap-2">
        {isOnline ? (
          <>
            <Wifi className="h-4 w-4" />
            <p className="text-sm font-medium">You're back online</p>
          </>
        ) : (
          <>
            <WifiOff className="h-4 w-4" />
            <p className="text-sm font-medium">
              You're offline. Some features may not be available.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

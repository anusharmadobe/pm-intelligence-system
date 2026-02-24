'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface AutoRefreshOptions {
  interval?: number; // milliseconds
  enabled?: boolean;
  onRefresh: () => void | Promise<void>;
}

export function useAutoRefresh({ interval = 60000, enabled = true, onRefresh }: AutoRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [nextRefresh, setNextRefresh] = useState<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await onRefresh();
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Auto-refresh failed:', error);
    } finally {
      setIsRefreshing(false);
    }
  }, [onRefresh, isRefreshing]);

  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setNextRefresh(null);
      return;
    }

    // Set next refresh time
    setNextRefresh(new Date(Date.now() + interval));

    // Set up interval
    intervalRef.current = setInterval(() => {
      refresh();
      setNextRefresh(new Date(Date.now() + interval));
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, refresh]);

  return {
    isRefreshing,
    lastRefresh,
    nextRefresh,
    refresh
  };
}

/**
 * Hook to format refresh time for display
 */
export function useRefreshTimer(nextRefresh: Date | null): string {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    if (!nextRefresh) {
      setTimeLeft('');
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = nextRefresh.getTime() - now;

      if (diff <= 0) {
        setTimeLeft('Refreshing...');
        return;
      }

      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);

      if (minutes > 0) {
        setTimeLeft(`${minutes}m ${seconds % 60}s`);
      } else {
        setTimeLeft(`${seconds}s`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [nextRefresh]);

  return timeLeft;
}

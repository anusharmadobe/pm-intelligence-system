'use client';

import { RefreshCw, Clock } from 'lucide-react';
import { useRefreshTimer } from '@/hooks/useAutoRefresh';

interface AutoRefreshIndicatorProps {
  isRefreshing: boolean;
  lastRefresh: Date | null;
  nextRefresh: Date | null;
  onRefresh: () => void;
}

export function AutoRefreshIndicator({
  isRefreshing,
  lastRefresh,
  nextRefresh,
  onRefresh
}: AutoRefreshIndicatorProps) {
  const timeLeft = useRefreshTimer(nextRefresh);

  return (
    <div className="flex items-center gap-3 text-sm text-gray-600">
      <button
        onClick={onRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Refresh now"
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
        <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
      </button>

      {lastRefresh && (
        <div className="flex items-center gap-1.5 text-xs">
          <Clock className="h-3.5 w-3.5" />
          <span>
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
      )}

      {nextRefresh && !isRefreshing && timeLeft && (
        <div className="text-xs text-gray-500">
          Next refresh in {timeLeft}
        </div>
      )}
    </div>
  );
}

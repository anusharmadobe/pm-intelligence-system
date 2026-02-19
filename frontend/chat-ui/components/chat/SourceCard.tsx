import { SupportingSignal } from '@/lib/types';
import { getSourceIcon, getSourceColor, formatDate, truncateText, cn } from '@/lib/utils';
import { ExternalLink, User, Calendar, FileText } from 'lucide-react';

interface SourceCardProps {
  signal: SupportingSignal;
  className?: string;
}

export function SourceCard({ signal, className }: SourceCardProps) {
  const sourceIcon = getSourceIcon(signal.source);
  const sourceColor = getSourceColor(signal.source);

  return (
    <div
      className={cn(
        'rounded-lg border bg-white p-3 text-sm transition-shadow hover:shadow-md',
        className
      )}
    >
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">{sourceIcon}</span>
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium border', sourceColor)}>
            {signal.source}
          </span>
          {signal.score && (
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
              Score: {signal.score.toFixed(2)}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      <p className="mb-2 text-gray-700 leading-relaxed">{truncateText(signal.snippet, 200)}</p>

      {/* Metadata */}
      <div className="flex flex-wrap gap-2 text-xs text-gray-500">
        {signal.metadata?.channel_name && (
          <div className="flex items-center gap-1">
            <span className="font-medium">#{signal.metadata.channel_name}</span>
          </div>
        )}

        {signal.metadata?.customer && (
          <div className="flex items-center gap-1">
            <User className="h-3 w-3" />
            <span>{signal.metadata.customer}</span>
          </div>
        )}

        {signal.metadata?.title && (
          <div className="flex items-center gap-1">
            <FileText className="h-3 w-3" />
            <span>{truncateText(signal.metadata.title, 30)}</span>
          </div>
        )}

        {signal.metadata?.competitor && (
          <div className="flex items-center gap-1">
            <span className="font-medium">{signal.metadata.competitor}</span>
          </div>
        )}

        {signal.created_at && (
          <div className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            <span>{formatDate(new Date(signal.created_at))}</span>
          </div>
        )}

        {signal.metadata?.url && (
          <a
            href={signal.metadata.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
          >
            <ExternalLink className="h-3 w-3" />
            <span>View source</span>
          </a>
        )}
      </div>
    </div>
  );
}

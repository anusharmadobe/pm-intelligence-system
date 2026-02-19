import { Message } from '@/lib/types';
import { formatDate, cn } from '@/lib/utils';
import { SourceCard } from './SourceCard';
import { Bot, User, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';

interface MessageBubbleProps {
  message: Message;
  className?: string;
}

export function MessageBubble({ message, className }: MessageBubbleProps) {
  const [showSources, setShowSources] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.isError;

  return (
    <div className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start', className)}>
      {/* Avatar */}
      {!isUser && (
        <div className="flex-shrink-0">
          <div
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full',
              isError ? 'bg-red-100' : 'bg-primary'
            )}
          >
            {isError ? (
              <AlertCircle className="h-5 w-5 text-red-600" />
            ) : (
              <Bot className="h-5 w-5 text-white" />
            )}
          </div>
        </div>
      )}

      {/* Message content */}
      <div className={cn('flex max-w-[80%] flex-col gap-2', isUser && 'items-end')}>
        {/* Bubble */}
        <div
          className={cn(
            'rounded-lg px-4 py-3',
            isUser
              ? 'bg-primary text-white'
              : isError
                ? 'bg-red-50 text-red-900 border border-red-200'
                : 'bg-gray-100 text-gray-900'
          )}
        >
          <p className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</p>

          {/* Confidence badge */}
          {!isUser && message.confidence !== undefined && !isError && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-gray-500">
                Confidence: {Math.round(message.confidence * 100)}%
              </span>
              {message.sources && message.sources.length > 0 && (
                <button
                  onClick={() => setShowSources(!showSources)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  {showSources ? (
                    <>
                      <ChevronUp className="h-3 w-3" />
                      Hide sources
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3 w-3" />
                      Show {message.sources.length} source{message.sources.length > 1 ? 's' : ''}
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Sources */}
        {!isUser && message.sources && message.sources.length > 0 && showSources && (
          <div className="flex w-full flex-col gap-2">
            <div className="text-xs font-medium text-gray-500">Supporting Sources:</div>
            {message.sources.map((signal, index) => (
              <SourceCard key={signal.id || index} signal={signal} />
            ))}
          </div>
        )}

        {/* Timestamp */}
        <span className="text-xs text-gray-500">{formatDate(message.timestamp)}</span>
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="flex-shrink-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-300">
            <User className="h-5 w-5 text-gray-600" />
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useChat } from '@/hooks/useChat';
import { PMIntelligenceClient } from '@/lib/api-client';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, MessageSquare, Sparkles, X } from 'lucide-react';

interface ChatInterfaceProps {
  apiClient: PMIntelligenceClient;
  conversationId?: string;
}

export function ChatInterface({ apiClient, conversationId }: ChatInterfaceProps) {
  const { messages, isLoading, error, sendMessage, clearError } = useChat({
    apiClient,
    conversationId
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showWelcome, setShowWelcome] = useState(messages.length === 0);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Hide welcome screen when first message is sent
  useEffect(() => {
    if (messages.length > 0) {
      setShowWelcome(false);
    }
  }, [messages]);

  const handleSendMessage = (message: string) => {
    sendMessage(message);
  };

  const quickActions = [
    'What are the top customer issues?',
    'Show me recent feedback about features',
    'What are competitors doing?',
    'List high-priority opportunities'
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b bg-white px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900">PM Intelligence Assistant</h1>
              <p className="text-sm text-gray-500">
                Ask questions about customer feedback, features, and opportunities
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-4">
        {/* Error banner */}
        {error && (
          <div className="mb-4 flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
            <button
              onClick={clearError}
              className="text-red-600 hover:text-red-800"
              aria-label="Dismiss error"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Welcome screen */}
        {showWelcome && messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
              <MessageSquare className="h-10 w-10 text-primary" />
            </div>

            <h2 className="mb-2 text-2xl font-semibold text-gray-900">
              Welcome to PM Intelligence
            </h2>
            <p className="mb-8 max-w-md text-gray-600">
              Ask questions about customer feedback, feature requests, opportunities, or competitor
              intelligence. I'll search across all your data sources to provide accurate answers.
            </p>

            <div className="w-full max-w-2xl">
              <p className="mb-3 text-sm font-medium text-gray-700">Quick actions:</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {quickActions.map((action, index) => (
                  <button
                    key={index}
                    onClick={() => handleSendMessage(action)}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-left text-sm transition-all hover:border-primary hover:shadow-md"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.length > 0 && (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="h-2 w-2 animate-pulse rounded-full bg-gray-400" />
            <div
              className="h-2 w-2 animate-pulse rounded-full bg-gray-400"
              style={{ animationDelay: '0.2s' }}
            />
            <div
              className="h-2 w-2 animate-pulse rounded-full bg-gray-400"
              style={{ animationDelay: '0.4s' }}
            />
            <span>Thinking...</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t bg-white px-6 py-4">
        <MessageInput
          onSend={handleSendMessage}
          disabled={isLoading}
          placeholder="Ask a question about your product..."
        />
        <p className="mt-2 text-xs text-gray-500">
          Press Enter to send, Shift+Enter for new line. Sources will be cited automatically.
        </p>
      </div>
    </div>
  );
}

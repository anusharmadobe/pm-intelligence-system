import { useState, useEffect, useCallback } from 'react';
import { PMIntelligenceClient } from '../lib/api-client';
import { Message, Conversation, QueryFilters } from '../lib/types';

interface UseChatOptions {
  conversationId?: string;
  apiClient: PMIntelligenceClient;
}

export function useChat({ conversationId, apiClient }: UseChatOptions) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string>(
    conversationId || crypto.randomUUID()
  );
  const [error, setError] = useState<string | null>(null);

  // Load conversation from storage if ID provided
  useEffect(() => {
    if (conversationId) {
      const conversation = apiClient.getConversation(conversationId);
      if (conversation) {
        setMessages(conversation.messages);
        setCurrentConversationId(conversation.id);
      }
    }
  }, [conversationId, apiClient]);

  // Save conversation to storage whenever messages change
  useEffect(() => {
    if (messages.length > 0) {
      const conversation: Conversation = {
        id: currentConversationId,
        title: messages[0]?.content.substring(0, 50) || 'New Conversation',
        messages,
        created_at: new Date(messages[0]?.timestamp || Date.now()),
        updated_at: new Date()
      };
      apiClient.saveConversation(conversation);
    }
  }, [messages, currentConversationId, apiClient]);

  const sendMessage = useCallback(
    async (content: string, filters?: QueryFilters) => {
      if (!content.trim()) return;

      // Add user message
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date()
      };

      setMessages(prev => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      try {
        // Query API
        const result = await apiClient.query(content, filters);

        // Add assistant response
        const assistantMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.answer,
          sources: result.supporting_signals,
          confidence: result.confidence,
          timestamp: new Date()
        };

        setMessages(prev => [...prev, assistantMessage]);
      } catch (error: any) {
        console.error('Failed to send message:', error);
        setError(error.message || 'Failed to get response');

        // Add error message
        const errorMessage: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `Error: ${error.message || 'Failed to get response from the server'}`,
          timestamp: new Date(),
          isError: true
        };

        setMessages(prev => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [apiClient]
  );

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setCurrentConversationId(crypto.randomUUID());
    setError(null);
  }, []);

  const deleteMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId));
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    conversationId: currentConversationId,
    sendMessage,
    startNewConversation,
    deleteMessage,
    clearError
  };
}

import { QueryResponse, QueryFilters, SupportingSignal, Conversation } from './types';

export class PMIntelligenceClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl?: string) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
  }

  /**
   * Query the system with natural language
   */
  async query(message: string, filters?: QueryFilters): Promise<QueryResponse> {
    const response = await fetch(`${this.baseUrl}/api/agents/v1/query`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: message, ...filters })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Query failed: ${response.statusText} - ${error}`);
    }

    return response.json();
  }

  /**
   * Search signals with filters
   */
  async searchSignals(query: string, filters?: QueryFilters): Promise<SupportingSignal[]> {
    const params = new URLSearchParams({ query });
    if (filters?.source) params.append('source', filters.source);
    if (filters?.customer) params.append('customer', filters.customer);
    if (filters?.feature) params.append('feature', filters.feature);

    const response = await fetch(`${this.baseUrl}/api/agents/v1/signals?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get customer profile
   */
  async getCustomerProfile(customerName: string): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/api/agents/v1/customer/${encodeURIComponent(customerName)}`,
      {
        headers: { 'X-API-Key': this.apiKey }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to get customer profile: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get all opportunities
   */
  async getOpportunities(filters?: { limit?: number; minConfidence?: number }): Promise<any> {
    const params = new URLSearchParams();
    if (filters?.limit) params.append('limit', filters.limit.toString());
    if (filters?.minConfidence) params.append('minConfidence', filters.minConfidence.toString());

    const response = await fetch(`${this.baseUrl}/api/agents/v1/opportunities?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get opportunities: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Save conversation to local storage
   */
  saveConversation(conversation: Conversation): void {
    const conversations = this.getConversations();
    const existingIndex = conversations.findIndex(c => c.id === conversation.id);

    if (existingIndex >= 0) {
      conversations[existingIndex] = conversation;
    } else {
      conversations.push(conversation);
    }

    localStorage.setItem('pm_conversations', JSON.stringify(conversations));
  }

  /**
   * Get all conversations from local storage
   */
  getConversations(): Conversation[] {
    const stored = localStorage.getItem('pm_conversations');
    if (!stored) return [];

    try {
      return JSON.parse(stored).map((c: any) => ({
        ...c,
        created_at: new Date(c.created_at),
        updated_at: new Date(c.updated_at),
        messages: c.messages.map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        }))
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get a specific conversation by ID
   */
  getConversation(id: string): Conversation | null {
    const conversations = this.getConversations();
    return conversations.find(c => c.id === id) || null;
  }

  /**
   * Delete a conversation
   */
  deleteConversation(id: string): void {
    const conversations = this.getConversations();
    const filtered = conversations.filter(c => c.id !== id);
    localStorage.setItem('pm_conversations', JSON.stringify(filtered));
  }

  /**
   * Create SSE connection for real-time updates
   */
  createEventStream(
    onEvent: (event: { type: string; data: any }) => void,
    onError?: (error: Error) => void
  ): EventSource {
    const eventSource = new EventSource(
      `${this.baseUrl}/api/agents/v1/events/stream?apiKey=${this.apiKey}`
    );

    eventSource.addEventListener('signal.ingested', (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent({ type: 'signal.ingested', data });
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    });

    eventSource.addEventListener('extraction.corrected', (event) => {
      try {
        const data = JSON.parse(event.data);
        onEvent({ type: 'extraction.corrected', data });
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    });

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      if (onError) onError(new Error('SSE connection failed'));
    };

    return eventSource;
  }

  /**
   * Test API connection
   */
  async testConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/health`, {
        headers: { 'X-API-Key': this.apiKey }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

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

  // ============ Cost Tracking Methods ============

  /**
   * Get dashboard overview with current month costs and top agents/models
   */
  async getCostDashboard(): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/cost/dashboard`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get cost dashboard: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get cost summary with optional filtering
   */
  async getCostSummary(options?: {
    agent_id?: string;
    signal_id?: string;
    date_from?: string;
    date_to?: string;
    group_by?: 'day' | 'week' | 'month';
  }): Promise<any> {
    const params = new URLSearchParams();
    if (options?.agent_id) params.append('agent_id', options.agent_id);
    if (options?.signal_id) params.append('signal_id', options.signal_id);
    if (options?.date_from) params.append('date_from', options.date_from);
    if (options?.date_to) params.append('date_to', options.date_to);
    if (options?.group_by) params.append('group_by', options.group_by);

    const response = await fetch(`${this.baseUrl}/api/cost/summary?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get cost summary: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get all agents with budget status
   */
  async getAgentBudgets(month?: string): Promise<any> {
    const params = month ? `?month=${month}` : '';
    const response = await fetch(`${this.baseUrl}/api/cost/agents${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get agent budgets: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get cost breakdown by model
   */
  async getCostByModel(dateFrom?: string, dateTo?: string): Promise<any> {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);

    const response = await fetch(`${this.baseUrl}/api/cost/models?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get cost by model: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get cost breakdown by operation type
   */
  async getCostByOperation(dateFrom?: string, dateTo?: string): Promise<any> {
    const params = new URLSearchParams();
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);

    const response = await fetch(`${this.baseUrl}/api/cost/operations?${params}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get cost by operation: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Get cost trends with projection
   */
  async getCostTrends(days: number = 30): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/cost/trends?days=${days}`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get cost trends: ${response.statusText}`);
    }

    return response.json();
  }

  // ============ Admin Cost Management Methods ============

  /**
   * Get detailed cost information for an agent
   */
  async getAgentCost(agentId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/admin/agents/${agentId}/cost`, {
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to get agent cost: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Update agent budget limit
   */
  async updateAgentBudget(agentId: string, maxMonthlyCostUsd: number): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/admin/agents/${agentId}/budget`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ max_monthly_cost_usd: maxMonthlyCostUsd })
    });

    if (!response.ok) {
      throw new Error(`Failed to update agent budget: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Reset agent monthly cost counter
   */
  async resetAgentBudget(agentId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/admin/agents/${agentId}/budget/reset`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to reset agent budget: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Pause an agent
   */
  async pauseAgent(agentId: string, reason?: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/admin/agents/${agentId}/pause`, {
      method: 'POST',
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reason })
    });

    if (!response.ok) {
      throw new Error(`Failed to pause agent: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * Unpause an agent
   */
  async unpauseAgent(agentId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/api/admin/agents/${agentId}/unpause`, {
      method: 'POST',
      headers: { 'X-API-Key': this.apiKey }
    });

    if (!response.ok) {
      throw new Error(`Failed to unpause agent: ${response.statusText}`);
    }

    return response.json();
  }
}

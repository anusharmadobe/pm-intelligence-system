export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sources?: SupportingSignal[];
  confidence?: number;
  isError?: boolean;
}

export interface SupportingSignal {
  id: string;
  source: string;
  snippet: string;
  created_at: string;
  score?: number;
  metadata?: {
    channel_name?: string;
    user_id?: string;
    title?: string;
    filename?: string;
    customer?: string;
    page_title?: string;
    url?: string;
    competitor?: string;
    content_type?: string;
  };
}

export interface QueryResponse {
  query: string;
  answer: string;
  confidence: number;
  supporting_signals: SupportingSignal[];
  sources?: Array<{
    source: string;
    relevance: number;
    result_count: number;
  }>;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  created_at: Date;
  updated_at: Date;
}

export interface QueryFilters {
  source?: string;
  customer?: string;
  feature?: string;
  theme?: string;
  sources?: string[];
}

/**
 * API Client for PM Intelligence System
 * Makes HTTP calls to backend API instead of direct imports
 */

import * as http from 'http';
import * as https from 'https';
import * as url from 'url';

// Lazy evaluation to avoid top-level process.env access
function getApiBase(): string {
  try {
    return process?.env?.API_BASE || 'http://localhost:3000';
  } catch {
    return 'http://localhost:3000';
  }
}

// HTTP client using Node's built-in http module (no fetch dependency)
function httpRequest(fullUrl: string, options: any): Promise<any> {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = url.parse(fullUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const requestOptions = {
        hostname: parsedUrl.hostname || 'localhost',
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.path || '/',
        method: options.method || 'GET',
        headers: options.headers || {},
      };

      const client = isHttps ? https : http;
      const req = client.request(requestOptions, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (!data) {
            resolve({});
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Invalid JSON response: ${data}`));
          }
        });
      });
      req.on('error', reject);
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

interface ApiResponse<T> {
  data?: T;
  error?: string;
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

async function apiCall<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: any
): Promise<T> {
  const url = `${getApiBase()}${endpoint}`;
  const bodyStr = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (bodyStr) {
    headers['Content-Length'] = String(Buffer.byteLength(bodyStr));
  }
  const options: any = {
    method,
    headers,
    body: bodyStr,
  };

  const data = await httpRequest(url, options);
  return data as T;
}

export const apiClient = {
  // Signals
  async ingestSignal(signal: {
    source: string;
    text: string;
    type?: string;
    id?: string;
    severity?: string;
    confidence?: number;
    metadata?: any;
  }) {
    return apiCall<any>('POST', '/api/signals', signal);
  },

  async getSignals(options?: {
    source?: string;
    signalType?: string;
    customer?: string;
    topic?: string;
    limit?: number;
    offset?: number;
  }) {
    const params: string[] = [];
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined) {
          params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
      });
    }
    const query = params.length > 0 ? '?' + params.join('&') : '';
    return apiCall<ApiResponse<any>>('GET', `/api/signals${query}`);
  },

  // Opportunities
  async detectOpportunities(incremental: boolean = true) {
    const endpoint = incremental 
      ? '/api/opportunities/detect/incremental'
      : '/api/opportunities/detect';
    return apiCall<any[]>('POST', endpoint);
  },

  async getOpportunities(options?: {
    source?: string;
    customer?: string;
    limit?: number;
    offset?: number;
  }) {
    const params: string[] = [];
    if (options) {
      Object.entries(options).forEach(([key, value]) => {
        if (value !== undefined) {
          params.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
        }
      });
    }
    const query = params.length > 0 ? '?' + params.join('&') : '';
    const response = await apiCall<any>('GET', `/api/opportunities${query}`);
    return (response.opportunities || response) as any[];
  },

  async getOpportunitySignals(opportunityId: string) {
    return apiCall<any[]>('GET', `/api/opportunities/${opportunityId}/signals`);
  },

  // Judgments
  async createJudgment(judgment: {
    opportunityId: string;
    userId: string;
    analysis: string;
    recommendation: string;
    confidence: number;
    reasoning?: string;
  }) {
    return apiCall<any>('POST', '/api/judgments', judgment);
  },

  async getJudgments(opportunityId: string) {
    return apiCall<any[]>('GET', `/api/judgments/${opportunityId}`);
  },

  // Artifacts
  async createArtifact(artifact: {
    judgmentId: string;
    type: string;
    content: string;
    metadata?: any;
  }) {
    return apiCall<any>('POST', '/api/artifacts', artifact);
  },

  async getArtifacts(judgmentId: string) {
    return apiCall<any[]>('GET', `/api/artifacts/${judgmentId}`);
  },

  // Metrics
  async getMetrics() {
    return apiCall<any>('GET', '/api/metrics');
  },
};

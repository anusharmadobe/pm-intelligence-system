import * as http from 'http';
import * as https from 'https';
import * as url from 'url';
import { LLMProvider } from './llm_service';
import { logger } from '../utils/logger';

interface CursorLlmProviderOptions {
  endpoint?: string;
  token?: string;
  timeoutMs?: number;
  model?: string;
  temperature?: number;
}

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
        timeout: options.timeout
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
      req.on('timeout', () => {
        req.destroy(new Error('Cursor LLM request timed out'));
      });
      if (options.body) {
        req.write(options.body);
      }
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

export function createCursorBridgeProvider(options: CursorLlmProviderOptions = {}): LLMProvider {
  const endpoint = options.endpoint || process.env.CURSOR_LLM_BRIDGE_URL || 'http://localhost:3344/llm';
  const token = options.token || process.env.CURSOR_LLM_BRIDGE_TOKEN;
  const timeoutMs = options.timeoutMs || Number(process.env.CURSOR_LLM_BRIDGE_TIMEOUT_MS || 120000);
  const defaultModel = options.model || process.env.CURSOR_LLM_MODEL;
  const defaultTemperature =
    typeof options.temperature === 'number'
      ? options.temperature
      : (process.env.CURSOR_LLM_TEMPERATURE ? Number(process.env.CURSOR_LLM_TEMPERATURE) : undefined);

  if (!token) {
    throw new Error('CURSOR_LLM_BRIDGE_TOKEN is required to call Cursor LLM bridge.');
  }

  return async (prompt: string): Promise<string> => {
    const body = {
      prompt,
      model: defaultModel,
      temperature: defaultTemperature
    };

    logger.info('Calling Cursor LLM bridge', {
      endpoint,
      hasModel: Boolean(defaultModel)
    });

    const response = await httpRequest(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      timeout: timeoutMs,
      body: JSON.stringify(body)
    });

    if (!response || typeof response.content !== 'string') {
      throw new Error('Cursor LLM bridge returned an invalid response.');
    }

    return response.content;
  };
}

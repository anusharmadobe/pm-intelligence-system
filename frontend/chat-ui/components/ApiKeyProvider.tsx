'use client';

import { useState, useEffect, createContext, useContext, ReactNode } from 'react';
import { PMIntelligenceClient } from '@/lib/api-client';
import { Key, Loader2 } from 'lucide-react';

interface ApiKeyContextValue {
  apiClient: PMIntelligenceClient | null;
  apiKey: string | null;
  setApiKey: (key: string) => void;
  clearApiKey: () => void;
}

const ApiKeyContext = createContext<ApiKeyContextValue>({
  apiClient: null,
  apiKey: null,
  setApiKey: () => {},
  clearApiKey: () => {}
});

export function useApiKey() {
  return useContext(ApiKeyContext);
}

interface ApiKeyProviderProps {
  children: ReactNode;
}

export function ApiKeyProvider({ children }: ApiKeyProviderProps) {
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [apiClient, setApiClient] = useState<PMIntelligenceClient | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check for stored API key
    const stored = localStorage.getItem('pm_api_key');
    if (stored) {
      setApiKeyState(stored);
      const client = new PMIntelligenceClient(stored);
      setApiClient(client);

      // Test connection
      client.testConnection().then((isConnected) => {
        if (!isConnected) {
          setError('Failed to connect to API. Please check your API key.');
        }
        setIsLoading(false);
      });
    } else {
      setIsLoading(false);
    }
  }, []);

  const setApiKey = (key: string) => {
    localStorage.setItem('pm_api_key', key);
    setApiKeyState(key);
    const client = new PMIntelligenceClient(key);
    setApiClient(client);
    setError(null);
  };

  const clearApiKey = () => {
    localStorage.removeItem('pm_api_key');
    setApiKeyState(null);
    setApiClient(null);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!apiKey || !apiClient) {
    return <ApiKeyLogin onLogin={setApiKey} />;
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="w-full max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-center">
          <p className="mb-4 text-red-800">{error}</p>
          <button
            onClick={clearApiKey}
            className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          >
            Try Different API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <ApiKeyContext.Provider value={{ apiClient, apiKey, setApiKey, clearApiKey }}>
      {children}
    </ApiKeyContext.Provider>
  );
}

interface ApiKeyLoginProps {
  onLogin: (key: string) => void;
}

function ApiKeyLogin({ onLogin }: ApiKeyLoginProps) {
  const [inputKey, setInputKey] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    // Test the API key
    const client = new PMIntelligenceClient(inputKey);
    const isValid = await client.testConnection();

    if (!isValid) {
      setError('Invalid API key or unable to connect to server');
      return;
    }

    onLogin(inputKey);
  };

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-lg border bg-white p-8 shadow-lg">
        <div className="mb-6 text-center">
          <div className="mb-4 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Key className="h-8 w-8 text-primary" />
            </div>
          </div>
          <h1 className="mb-2 text-2xl font-semibold text-gray-900">PM Intelligence</h1>
          <p className="text-sm text-gray-600">Enter your API key to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="apiKey" className="mb-2 block text-sm font-medium text-gray-700">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={inputKey}
              onChange={(e) => {
                setInputKey(e.target.value);
                setError('');
              }}
              placeholder="Enter your API key..."
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
          </div>

          <button
            type="submit"
            className="w-full rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary/90"
          >
            Connect
          </button>
        </form>

        <div className="mt-6 text-center text-xs text-gray-500">
          <p>Don't have an API key?</p>
          <p className="mt-1">Contact your administrator or check the backend API documentation.</p>
        </div>
      </div>
    </div>
  );
}

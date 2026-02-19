'use client';

import { ChatInterface } from '@/components/chat/ChatInterface';
import { useApiKey } from '@/components/ApiKeyProvider';

// Disable static generation for this page
export const dynamic = 'force-dynamic';

export default function Home() {
  const { apiClient } = useApiKey();

  if (!apiClient) {
    return null; // ApiKeyProvider will show login screen
  }

  return (
    <main className="h-screen">
      <ChatInterface apiClient={apiClient} />
    </main>
  );
}

'use client';

import { AlertCircle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="flex h-screen items-center justify-center bg-gray-50">
          <div className="w-full max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-red-100">
                <AlertCircle className="h-10 w-10 text-red-600" />
              </div>
            </div>
            <h1 className="mb-4 text-2xl font-semibold text-gray-900">Application Error</h1>
            <p className="mb-6 text-gray-600">
              A critical error occurred. Please refresh the page to continue.
            </p>
            {error.digest && (
              <p className="mb-6 text-sm text-gray-500">Error ID: {error.digest}</p>
            )}
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-white transition-colors hover:bg-primary/90"
            >
              <RefreshCw className="h-5 w-5" />
              Reload Application
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}

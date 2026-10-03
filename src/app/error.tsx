'use client';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('System error captured:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600 text-2xl font-bold mb-4 font-mono-code">
        !
      </div>
      <h1 className="text-xl font-bold text-slate-900 tracking-tight mb-2">Application Error</h1>
      <p className="text-sm text-slate-600 max-w-sm mb-6">
        An unexpected operational error occurred while processing your request. All audit state remains intact.
      </p>
      <button
        onClick={() => reset()}
        className="inline-flex items-center px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white bg-slate-900 hover:bg-slate-800 rounded transition"
      >
        Retry Operation
      </button>
    </div>
  );
}

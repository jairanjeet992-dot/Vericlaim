import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center text-slate-700 text-2xl font-bold mb-4 font-mono-code">
        404
      </div>
      <h1 className="text-xl font-bold text-slate-900 tracking-tight mb-2">Page Not Found</h1>
      <p className="text-sm text-slate-600 max-w-sm mb-6">
        The requested resource or claim docket could not be located on this server.
      </p>
      <Link
        href="/"
        className="inline-flex items-center px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white bg-slate-900 hover:bg-slate-800 rounded transition"
      >
        Return to Portal
      </Link>
    </div>
  );
}

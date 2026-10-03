'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [agencyCode, setAgencyCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [showTotpField, setShowTotpField] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agency_code: agencyCode.trim().toUpperCase(),
          username: username.trim().toLowerCase(),
          password,
          totp_code: totpCode ? totpCode.trim() : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (data.totpRequired) {
          setShowTotpField(true);
          setErrorMessage('Two-factor authentication code required. Please enter 6-digit code.');
        } else {
          setErrorMessage(data.error || 'Authentication failed');
        }
        return;
      }

      router.push(data.redirectUrl || '/dashboard');
    } catch {
      setErrorMessage('Network connection error. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 shadow-sm rounded-lg p-6">
        <div className="mb-6 border-b border-slate-100 pb-4">
          <div className="flex items-center space-x-2">
            <div className="h-6 w-6 bg-slate-900 text-white flex items-center justify-center font-bold text-xs rounded">
              V
            </div>
            <h1 className="text-base font-bold tracking-tight text-slate-900">VERICLAIM</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">Agency Operations Login</p>
        </div>

        {errorMessage && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-700">
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Agency Code
            </label>
            <input
              type="text"
              required
              value={agencyCode}
              onChange={(e) => setAgencyCode(e.target.value.toUpperCase())}
              placeholder="e.g. DNA"
              className="w-full text-sm font-mono-code px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900 uppercase"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="username"
              className="w-full text-sm px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900 lowercase"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900"
            />
          </div>

          {showTotpField && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                2FA TOTP Code (6 Digits)
              </label>
              <input
                type="text"
                required
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.trim())}
                placeholder="123456"
                className="w-full font-mono-code px-3 py-2 border border-blue-400 bg-blue-50/50 rounded focus:outline-none focus:border-slate-900 text-center tracking-widest text-lg font-bold"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2 px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold uppercase tracking-wider rounded transition disabled:opacity-50"
          >
            {isLoading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between text-[11px] text-slate-400">
          <span>Protected Multi-Tenant System</span>
          <span>v0.1.0</span>
        </div>
      </div>
    </div>
  );
}

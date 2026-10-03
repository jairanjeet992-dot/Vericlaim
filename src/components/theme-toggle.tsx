'use client';

import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from './theme-provider';

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      type="button"
      title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      className={`relative inline-flex items-center justify-center p-2 rounded-xl border transition-all duration-300 ${
        theme === 'dark'
          ? 'bg-slate-900/80 border-slate-700/80 text-amber-300 hover:bg-slate-800 hover:border-amber-400/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]'
          : 'bg-white/80 border-slate-200/90 text-slate-700 hover:bg-slate-100 hover:text-slate-900 shadow-2xs'
      } ${className}`}
      aria-label="Toggle theme"
    >
      <div className="relative w-4 h-4 flex items-center justify-center">
        {theme === 'dark' ? (
          <Sun className="h-4 w-4 transition-transform duration-300 rotate-0 scale-100" />
        ) : (
          <Moon className="h-4 w-4 transition-transform duration-300 rotate-0 scale-100 text-indigo-600" />
        )}
      </div>
    </button>
  );
}

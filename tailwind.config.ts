import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/modules/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f5fa',
          100: '#d9e6f2',
          200: '#b8d2e7',
          300: '#8bb6d8',
          400: '#5894c5',
          500: '#3577b0',
          600: '#275e92',
          700: '#1d4872',
          800: '#112233',
          900: '#0a1622',
        },
        gold: {
          50: '#fbf9f1',
          100: '#f6f1de',
          200: '#ede1be',
          300: '#e1cb95',
          400: '#d3b069',
          500: '#b8862e',
          600: '#a37126',
          700: '#825621',
          800: '#6b4620',
          900: '#593a1e',
        }
      },
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      }
    },
  },
  plugins: [],
};
export default config;

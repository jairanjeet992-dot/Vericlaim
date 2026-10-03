import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().default('https://mock-supabase.vericlaim.local'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).default('mock-anon-key-vericlaim'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  AUTH_INTERNAL_DOMAIN: z.string().min(1).default('auth.vericlaim.in'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export const env = envSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  AUTH_INTERNAL_DOMAIN: process.env.AUTH_INTERNAL_DOMAIN,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

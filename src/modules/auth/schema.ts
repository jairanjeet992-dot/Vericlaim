import { z } from 'zod';

export const LoginFormSchema = z.object({
  agency_code: z
    .string()
    .min(2, 'Agency code must be at least 2 characters')
    .max(16, 'Agency code must not exceed 16 characters')
    .transform((val) => val.trim().toUpperCase()),
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(64, 'Username must not exceed 64 characters')
    .transform((val) => val.trim().toLowerCase()),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  totp_code: z.string().length(6, 'TOTP code must be 6 digits').optional(),
});

export type LoginFormData = z.infer<typeof LoginFormSchema>;

export const PasswordResetSchema = z.object({
  user_id: z.string().uuid(),
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type PasswordResetData = z.infer<typeof PasswordResetSchema>;

import crypto from 'crypto';

/**
 * Generates an internal synthetic auth email compliant with rule A4:
 * Format: u_<user_uuid>@auth.<domain>
 */
export function generateSyntheticEmail(userId?: string, domain: string = 'auth.vericlaim.in'): string {
  const id = userId || crypto.randomUUID();
  const cleanId = id.replace(/-/g, '');
  return `u_${cleanId}@${domain}`;
}

/**
 * Validates that an email matches the internal synthetic email pattern
 */
export function isSyntheticEmail(email: string, domain: string = 'auth.vericlaim.in'): boolean {
  const regex = new RegExp(`^u_[a-f0-9]{32}@${domain.replace(/\./g, '\\.')}$`, 'i');
  return regex.test(email);
}

export const isValidSyntheticEmail = isSyntheticEmail;

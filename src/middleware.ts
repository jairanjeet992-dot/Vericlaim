import { NextRequest, NextResponse } from 'next/server';
import { globalRateLimiter } from '@/lib/rate-limiter';

// Security Headers Configuration (Rule A7: Secure headers + strict CSP, no third-party ad/analytics)
const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co https://*.r2.cloudflarestorage.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const RATE_LIMIT_RULES: Record<string, { maxRequests: number; windowMs: number }> = {
  '/api/uploads': { maxRequests: 60, windowMs: 60000 },      // 60 uploads / min
  '/api/search': { maxRequests: 120, windowMs: 60000 },       // 120 searches / min
  '/api/reports/export': { maxRequests: 20, windowMs: 60000 },// 20 exports / min
  '/api/migration': { maxRequests: 30, windowMs: 60000 },     // 30 migration actions / min
  '/login': { maxRequests: 15, windowMs: 60000 },            // 15 login attempts / min
};

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const ip = req.ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '127.0.0.1';

  // 1. Rate Limiting Check on Sensitive Perimeters (Rule A7)
  for (const [prefix, config] of Object.entries(RATE_LIMIT_RULES)) {
    if (pathname.startsWith(prefix)) {
      const rateLimitRes = globalRateLimiter.check(ip, prefix, config);
      if (!rateLimitRes.allowed) {
        return new NextResponse(
          JSON.stringify({
            error: 'Too Many Requests',
            message: `Rate limit exceeded on ${prefix}. Please try again later.`,
            retryAfter: rateLimitRes.retryAfterSeconds,
          }),
          {
            status: 429,
            headers: {
              'Content-Type': 'application/json',
              'Retry-After': String(rateLimitRes.retryAfterSeconds || 60),
              'X-RateLimit-Limit': String(config.maxRequests),
              'X-RateLimit-Remaining': '0',
              'X-RateLimit-Reset': String(rateLimitRes.resetAt),
            },
          }
        );
      }
      break;
    }
  }

  // 2. Pass to downstream route and attach authoritative security headers
  const response = NextResponse.next();

  response.headers.set('Content-Security-Policy', STRICT_CSP);
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(self), geolocation=(self), microphone=(), payment=()');
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
  response.headers.set('X-DNS-Prefetch-Control', 'off');

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - static files (svg, png, jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterSeconds?: number;
}

interface ClientBucket {
  tokens: number;
  lastRefill: number;
}

/**
 * High-performance sliding window / token bucket rate limiter for API endpoints (Rule A7)
 */
export class MemoryRateLimiter {
  private buckets = new Map<string, ClientBucket>();
  private defaultLimit: number;
  private defaultWindowMs: number;

  constructor(defaultLimit = 100, defaultWindowMs = 60000) {
    this.defaultLimit = defaultLimit;
    this.defaultWindowMs = defaultWindowMs;

    // Periodic cleanup of stale buckets every 5 minutes to prevent memory leaks
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.cleanup(), 300000);
    }
  }

  public check(
    clientIdentifier: string,
    routePrefix: string,
    customConfig?: RateLimitConfig
  ): RateLimitResult {
    const limit = customConfig?.maxRequests || this.defaultLimit;
    const windowMs = customConfig?.windowMs || this.defaultWindowMs;
    const now = Date.now();
    const key = `${routePrefix}:::${clientIdentifier}`;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: limit, lastRefill: now };
      this.buckets.set(key, bucket);
    } else {
      // Calculate token refill based on elapsed time
      const elapsed = now - bucket.lastRefill;
      if (elapsed > windowMs) {
        bucket.tokens = limit;
        bucket.lastRefill = now;
      } else {
        const refillRate = limit / windowMs;
        const tokensToAdd = Math.floor(elapsed * refillRate);
        if (tokensToAdd > 0) {
          bucket.tokens = Math.min(limit, bucket.tokens + tokensToAdd);
          bucket.lastRefill = now;
        }
      }
    }

    if (bucket.tokens > 0) {
      bucket.tokens -= 1;
      const resetAt = bucket.lastRefill + windowMs;
      return {
        allowed: true,
        remaining: bucket.tokens,
        resetAt
      };
    } else {
      const resetAt = bucket.lastRefill + windowMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds
      };
    }
  }

  public reset(clientIdentifier?: string, routePrefix?: string): void {
    if (clientIdentifier && routePrefix) {
      this.buckets.delete(`${routePrefix}:::${clientIdentifier}`);
    } else {
      this.buckets.clear();
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 600000; // 10 minutes
    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastRefill > maxAge) {
        this.buckets.delete(key);
      }
    }
  }
}

export const globalRateLimiter = new MemoryRateLimiter();

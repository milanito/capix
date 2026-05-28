/**
 * jwt-cache.ts — In-memory cache for JWT verification results.
 *
 * SECURITY: Cached tokens remain valid until TTL expires even if the token
 * is revoked (e.g. via logout, secret rotation, or token blocklist). Use a
 * short TTL (≤60s) in security-sensitive deployments and always implement a
 * blocklist for immediate revocation when needed.
 *
 * When to use: High-traffic APIs where the same token (e.g. a service account
 * or a user with many rapid requests) dominates the request stream and HMAC
 * verification latency is measurable. In most apps, the database round-trip
 * in `userFromToken` dominates — disable caching there and only enable it for
 * pure in-memory `userFromToken` implementations.
 */

export type JWTCacheOptions = {
  /**
   * How long a cached verification result is valid, in milliseconds.
   * Default: 30_000 (30 seconds).
   *
   * **Security tradeoff**: A revoked token remains accepted for up to this
   * duration. Use ≤60_000 in production. Set to 0 to disable caching.
   */
  readonly ttl?: number;
  /**
   * Maximum number of entries in the cache.
   * Oldest entries are evicted when the limit is reached (LRU eviction).
   * Default: 1_000.
   */
  readonly maxSize?: number;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * Bounded LRU cache for JWT verification results.
 *
 * Thread safety: Node.js is single-threaded; no locking needed.
 */
export class JWTCache<T> {
  private readonly map = new Map<string, CacheEntry<T>>();
  private readonly ttl: number;
  private readonly maxSize: number;

  constructor(opts: JWTCacheOptions = {}) {
    this.ttl = opts.ttl ?? 30_000;
    this.maxSize = opts.maxSize ?? 1_000;
  }

  get(token: string): T | undefined {
    const entry = this.map.get(token);
    if (entry === undefined) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.map.delete(token);
      return undefined;
    }

    // Refresh access order for LRU
    this.map.delete(token);
    this.map.set(token, entry);
    return entry.value;
  }

  set(token: string, value: T): void {
    if (this.ttl === 0) return;

    // Evict oldest entry if at capacity
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }

    this.map.set(token, { value, expiresAt: Date.now() + this.ttl });
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

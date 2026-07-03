/**
 * jwks.ts — JWKS (JSON Web Key Set) key resolution with caching.
 *
 * Fetches the key set from an issuer's JWKS endpoint (Auth0, Clerk, Cognito,
 * Keycloak, ...), converts each JWK to a Node KeyObject via the platform's
 * native JWK support, and resolves keys by `kid`. The set is cached; an
 * unknown `kid` triggers one refetch (key rotation) subject to a minimum
 * refetch interval so a flood of bad tokens cannot hammer the endpoint.
 */

import { createPublicKey } from 'node:crypto';
import type { KeyObject } from 'node:crypto';

export type JwksOptions = {
  /** JWKS endpoint URL (e.g. https://tenant.auth0.com/.well-known/jwks.json). */
  readonly url: string;
  /** How long a fetched key set stays fresh. Default: 10 minutes. */
  readonly cacheTtlMs?: number;
  /** Minimum time between refetches triggered by unknown kids. Default: 30s. */
  readonly minRefetchIntervalMs?: number;
};

type Jwk = Record<string, unknown> & { kid?: string; use?: string };

export class JwksKeyResolver {
  private keys = new Map<string, KeyObject>();
  private fetchedAt = 0;
  private lastAttemptAt = 0;
  private pending: Promise<void> | null = null;

  private readonly url: string;
  private readonly cacheTtlMs: number;
  private readonly minRefetchIntervalMs: number;

  constructor(options: JwksOptions) {
    this.url = options.url;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.minRefetchIntervalMs = options.minRefetchIntervalMs ?? 30_000;
  }

  /**
   * Resolves the verification key for a token's `kid`.
   * Returns null when the kid is unknown even after a (rate-limited) refetch.
   */
  async getKey(kid: string): Promise<KeyObject | null> {
    const now = Date.now();
    const stale = now - this.fetchedAt >= this.cacheTtlMs;

    if (!stale) {
      const hit = this.keys.get(kid);
      if (hit !== undefined) return hit;
    }

    // Miss or stale — refetch, but never more often than the refetch interval
    if (stale || !this.keys.has(kid)) {
      if (now - this.lastAttemptAt >= this.minRefetchIntervalMs || this.fetchedAt === 0) {
        await this.refetch();
      }
    }

    return this.keys.get(kid) ?? null;
  }

  private refetch(): Promise<void> {
    // Concurrent verifies share one in-flight fetch
    this.pending ??= this.doFetch().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async doFetch(): Promise<void> {
    this.lastAttemptAt = Date.now();
    try {
      const res = await fetch(this.url);
      if (!res.ok) return; // keep serving the previous key set
      const body = (await res.json()) as { keys?: Jwk[] };
      if (!Array.isArray(body.keys)) return;

      const next = new Map<string, KeyObject>();
      for (const jwk of body.keys) {
        if (typeof jwk.kid !== 'string') continue;
        if (jwk.use !== undefined && jwk.use !== 'sig') continue;
        try {
          next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
        } catch {
          // Skip malformed or unsupported keys; the rest of the set still loads
        }
      }
      this.keys = next;
      this.fetchedAt = Date.now();
    } catch {
      // Network failure — keep serving the previous key set until it works
    }
  }
}

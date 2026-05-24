/**
 * enhancers.ts — built-in capability enhancers
 * Depends on: capability.ts
 */

import type { Enhancer, AnyCapability } from './capability.js';
import { isFrameworkError } from './errors.js';

/** Pass-through for type inference. */
export function defineEnhancer(fn: Enhancer): Enhancer {
  return fn;
}

/** Logs capability name, duration, and outcome. Falls back to console if ctx has no logger. */
export const withLogging = defineEnhancer((cap) => ({
  ...cap,
  resolve: async (input: unknown, ctx: Record<string, unknown>) => {
    const start = Date.now();
    const logger =
      typeof ctx['logger'] === 'object' && ctx['logger'] !== null
        ? (ctx['logger'] as { info: (msg: string) => void; error: (msg: string) => void })
        : { info: console.info, error: console.error };
    try {
      const result = await (cap as AnyCapability).resolve(input, ctx);
      logger.info(`[capix] ${cap.name} ok (${Date.now() - start}ms)`);
      return result;
    } catch (err) {
      logger.error(`[capix] ${cap.name} error (${Date.now() - start}ms)`);
      throw err;
    }
  },
})) as Enhancer;

const cacheStore = new Map<string, { value: unknown; expiresAt: number }>();

/** In-memory cache. Key = capabilityName:JSON(input). TTL in seconds. */
export function withCache(ttlSeconds: number): Enhancer {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      const key = `${cap.name}:${JSON.stringify(input)}`;
      const cached = cacheStore.get(key);
      if (cached !== undefined && cached.expiresAt > Date.now()) {
        return cached.value;
      }
      const result = await (cap as AnyCapability).resolve(input, ctx);
      cacheStore.set(key, { value: result, expiresAt: Date.now() + ttlSeconds * 1000 });
      return result;
    },
  })) as Enhancer;
}

/** Rejects if the resolver exceeds the given milliseconds. */
export function withTimeout(ms: number): Enhancer {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: (input: unknown, ctx: unknown) => {
      return Promise.race([
        (cap as AnyCapability).resolve(input, ctx),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Capability '${cap.name}' timed out after ${ms}ms`)), ms),
        ),
      ]);
    },
  })) as Enhancer;
}

/** Retries on non-FrameworkError failures with exponential backoff. */
export function withRetry(maxAttempts: number, delayMs = 100): Enhancer {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          return await (cap as AnyCapability).resolve(input, ctx);
        } catch (err) {
          // Don't retry FrameworkErrors — they are intentional
          if (isFrameworkError(err)) throw err;
          lastError = err;
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, attempt - 1)));
          }
        }
      }
      throw lastError;
    },
  })) as Enhancer;
}

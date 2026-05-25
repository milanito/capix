/**
 * plugin.ts — plugin system
 * Depends on: capability.ts, errors.ts, guards.ts, context.ts
 */

import type { AnyCapability } from './capability.js';
import type { BaseContext, ContextBuilder, RawRequest } from './context.js';
import type { ErrorFactory } from './errors.js';
import type { Enhancer } from './capability.js';
import type { AnyGuard } from './guards.js';

export type Plugin = {
  readonly name: string;
  /**
   * Extend the request context after it has been built by the user's ContextBuilder.
   * Receives both the built context and the original raw request so plugins can
   * read headers, URLs, etc. May be async.
   */
  readonly context?: (base: BaseContext, req: RawRequest) => BaseContext | Promise<BaseContext>;
  readonly errors?: Record<string, ErrorFactory>;
  readonly enhancers?: Record<string, Enhancer | ((...args: unknown[]) => Enhancer)>;
  readonly capabilities?: Record<string, AnyCapability>;
  readonly guards?: Record<string, AnyGuard>;
};

/** Pass-through for type inference. */
export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

export type MergedPlugins = {
  readonly wrapContext: (builder: ContextBuilder) => ContextBuilder;
  readonly additionalCapabilities: Record<string, AnyCapability>;
};

/**
 * Merges multiple plugins into a single result.
 * Throws at startup if any capability names collide.
 */
export function mergePlugins(plugins: Plugin[]): MergedPlugins {
  const allCaps: Record<string, AnyCapability> = {};

  for (const plugin of plugins) {
    for (const [key, cap] of Object.entries(plugin.capabilities ?? {})) {
      if (key in allCaps) {
        throw new Error(
          `[capix] Plugin capability name collision: '${key}' is defined by multiple plugins`,
        );
      }
      allCaps[key] = cap;
    }
  }

  const contextExtensions = plugins
    .filter((p) => p.context !== undefined)
    .map((p) => p.context!);

  function wrapContext(builder: ContextBuilder): ContextBuilder {
    return async (req) => {
      let ctx = await builder(req);
      for (const extend of contextExtensions) {
        ctx = (await extend(ctx, req)) as Awaited<ReturnType<ContextBuilder>>;
      }
      return ctx;
    };
  }

  return {
    wrapContext,
    additionalCapabilities: allCaps,
  };
}

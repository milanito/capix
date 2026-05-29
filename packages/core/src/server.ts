/**
 * server.ts — server creation and transport orchestration
 * Depends on: all above
 */

import type { AnyCapability, CapabilityRegistry } from './capability.js';
import { compileRegistry } from './capability.js';
import type { ContextBuilder } from './context.js';
import type { InvokeFn } from './execution-engine.js';
import { createExecutionEngine } from './execution-engine.js';
import type { Plugin } from './plugin.js';
import { mergePlugins } from './plugin.js';

export type MountOptions = {
  readonly registry: CapabilityRegistry;
  readonly invoke: InvokeFn;
};

export interface Transport {
  mount(invoke: InvokeFn, options: MountOptions): void | Promise<void>;
  unmount(): Promise<void>;
}

export type ServerConfig = {
  readonly context: ContextBuilder;
  readonly capabilities: Record<string, AnyCapability | Record<string, unknown>>;
  readonly transports: Transport[];
  readonly plugins?: Plugin[];
  readonly isDevelopment?: boolean;
};

export type Server = {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly invoke: InvokeFn;
};

/** Creates a Capix server from a config object. */
export function createServer(config: ServerConfig): Server {
  const plugins = config.plugins ?? [];
  const { wrapContext, additionalCapabilities } = mergePlugins(plugins);

  const wrappedContext = wrapContext(config.context);

  // Detect collisions between user capabilities and plugin capabilities at startup
  for (const key of Object.keys(additionalCapabilities)) {
    if (key in config.capabilities) {
      throw new Error(
        `[capix] Capability name collision: '${key}' is defined by both the user and a plugin. ` +
        `Plugin capabilities must use unique top-level names.`,
      );
    }
  }

  const tree = {
    ...config.capabilities,
    ...additionalCapabilities,
  };

  const registry = compileRegistry(tree as Parameters<typeof compileRegistry>[0]);

  const invoke = createExecutionEngine({
    registry,
    buildContext: wrappedContext,
    isDevelopment: config.isDevelopment ?? process.env['NODE_ENV'] !== 'production',
  });

  const mountOptions: MountOptions = { registry, invoke };

  return {
    invoke,

    async start() {
      if (config.transports.length === 0) {
        console.warn(
          '[capix] Warning: no transports registered. The server will start but cannot receive requests. ' +
          'Add at least one transport to createServer({ transports: [...] }).',
        );
      }
      if (registry.size === 0) {
        console.warn(
          '[capix] Warning: no capabilities registered. ' +
          'Add capabilities to createServer({ capabilities: { ... } }).',
        );
      }
      for (const transport of config.transports) {
        await transport.mount(invoke, mountOptions);
      }
    },

    async stop() {
      for (const transport of config.transports) {
        await transport.unmount();
      }
    },
  };
}

/** Pass-through for config type inference. */
export function defineConfig(config: ServerConfig): ServerConfig {
  return config;
}

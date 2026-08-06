/**
 * server.ts — server creation and transport orchestration
 * Depends on: all above
 */

import type { AnyCapability, CapabilityRegistry, GroupTree } from './capability.js';
import { compileRegistry } from './capability.js';
import type { ContextBuilder } from './context.js';
import type { InvokeFn, LifecycleHooks } from './execution-engine.js';
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

/**
 * A Transport that declares its own capability registry.
 * `createServer` reads `_capabilities` during `start()` and compiles a
 * separate registry for this transport, overriding the server-level default.
 */
export type TransportWithCapabilities = Transport & {
  /** Set by transport factories when the caller passes a `capabilities` option. */
  readonly _capabilities?: GroupTree;
};

export type ServerConfig = {
  readonly context: ContextBuilder;
  /**
   * Default capability registry for all transports that don't declare their own.
   * Optional when every transport specifies its own `capabilities`.
   */
  readonly capabilities?: Record<string, AnyCapability | Record<string, unknown>>;
  readonly transports: Transport[];
  readonly plugins?: Plugin[];
  readonly isDevelopment?: boolean;
  /**
   * Lifecycle hooks observing every capability invocation on every transport
   * — the integration point for tracing, metrics, and error reporting.
   * See the observability guide for OpenTelemetry and Sentry recipes.
   */
  readonly hooks?: LifecycleHooks;
};

export type Server = {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly invoke: InvokeFn;
};

/**
 * Creates a Capix server from a config object.
 *
 * Compiles the capability tree into a registry, wires plugins, and returns a
 * server with `start()` / `stop()` lifecycle methods and a direct `invoke()`
 * entry point (useful for testing without HTTP).
 *
 * Per-transport capabilities: pass `capabilities` to a transport factory to
 * override the server-level default for that transport only:
 *
 * ```ts
 * createServer({
 *   context: buildContext,
 *   transports: [
 *     restTransport({ port: 3000, capabilities: publicCaps }),
 *     queueTransport({ queues: ['jobs'], adapter, capabilities: jobCaps }),
 *   ],
 * });
 * ```
 *
 * @throws {Error} At construction time if a plugin capability name collides with
 *   a user capability name.
 * @throws {Error} In `start()` if a transport has no capabilities (neither its
 *   own nor a server-level default).
 */
export function createServer(config: ServerConfig): Server {
  const plugins = config.plugins ?? [];
  const { wrapContext, additionalCapabilities } = mergePlugins(plugins);

  const wrappedContext = wrapContext(config.context);

  // Detect collisions between plugin capabilities and every capability tree a
  // plugin capability could end up merged into — the server-level default AND
  // each transport's own `_capabilities` override (transports fall back to
  // config.capabilities only when they don't declare their own; either way,
  // plugin capabilities are merged in unconditionally in start()).
  function checkCapabilityCollision(caps: Record<string, unknown> | undefined, source: string): void {
    if (caps === undefined) return;
    for (const key of Object.keys(additionalCapabilities)) {
      if (key in caps) {
        throw new Error(
          `[capix] Capability name collision: '${key}' is defined by both ${source} and a plugin. ` +
          `Plugin capabilities must use unique top-level names.`,
        );
      }
    }
  }

  checkCapabilityCollision(config.capabilities, 'the user');
  config.transports.forEach((transport, i) => {
    checkCapabilityCollision((transport as TransportWithCapabilities)._capabilities, `transport #${i}`);
  });

  // Server-level registry — backs server.invoke() regardless of transport config
  const serverTree = {
    ...(config.capabilities ?? {}),
    ...additionalCapabilities,
  };
  const serverRegistry = compileRegistry(serverTree as Parameters<typeof compileRegistry>[0]);
  const serverInvoke = createExecutionEngine({
    registry:      serverRegistry,
    buildContext:  wrappedContext,
    isDevelopment: config.isDevelopment ?? process.env['NODE_ENV'] !== 'production',
    ...(config.hooks !== undefined ? { hooks: config.hooks } : {}),
  });

  const isDev = config.isDevelopment ?? process.env['NODE_ENV'] !== 'production';

  return {
    invoke: serverInvoke,

    async start() {
      if (config.transports.length === 0) {
        console.warn(
          '[capix] Warning: no transports registered. The server will start but cannot receive requests. ' +
          'Add at least one transport to createServer({ transports: [...] }).',
        );
      }

      // Warn only when there are genuinely no capabilities anywhere
      const hasPerTransportCaps = config.transports.some(
        (t) => (t as TransportWithCapabilities)._capabilities != null,
      );
      if (serverRegistry.size === 0 && !hasPerTransportCaps) {
        console.warn(
          '[capix] Warning: no capabilities registered. ' +
          'Add capabilities to createServer({ capabilities: { ... } }).',
        );
      }

      for (const transport of config.transports) {
        const transportCaps = (transport as TransportWithCapabilities)._capabilities;
        const caps = transportCaps ?? config.capabilities;

        if (caps == null) {
          throw new Error(
            '[capix] Transport has no capabilities. ' +
            'Either set capabilities on the transport or provide a ' +
            'top-level capabilities map in createServer().',
          );
        }

        // Plugin additional capabilities are always merged in
        const tree = { ...caps, ...additionalCapabilities };
        const registry = compileRegistry(tree as Parameters<typeof compileRegistry>[0]);
        const invoke   = createExecutionEngine({
          registry,
          buildContext: wrappedContext,
          isDevelopment: isDev,
          ...(config.hooks !== undefined ? { hooks: config.hooks } : {}),
        });

        await transport.mount(invoke, { registry, invoke });
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

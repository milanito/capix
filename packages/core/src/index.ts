/**
 * index.ts — public API exports for the 'capix' package
 */

// Errors
export { defineError, isFrameworkError, defaultErrors } from './errors.js';
export type { FrameworkError, ErrorFactory } from './errors.js';

// Context
export { defineContext, getHeader } from './context.js';
export type { RawRequest, BaseContext, ContextBuilder } from './context.js';

// Guards
export { defineGuard, defineGuardFor, runGuards, defineInputGuard, runInputGuards } from './guards.js';
export type { Guard, NarrowingGuard, AnyGuard, NarrowContext, InputGuard, AnyInputGuard } from './guards.js';

// Capability
export { capability, isCapability, compileRegistry, inferIntent } from './capability.js';
export type {
  Intent,
  HttpOverride,
  Enhancer,
  Resolver,
  Capability,
  AnyCapability,
  CapabilityRegistry,
  GroupTree,
  InferInput,
  InferOutput,
  InferContext,
  ScopedCapabilityFactory,
} from './capability.js';

// Enhancers
export {
  defineEnhancer,
  withLogging,
  withCache,
  withTimeout,
  withRetry,
  withRateLimit,
  withMetrics,
  withCircuitBreaker,
  consoleMetricsCollector,
  rateLimitStore,
  cacheStore,
} from './enhancers.js';
export type {
  RateLimitOptions,
  MetricsCollector,
  CircuitBreakerOptions,
} from './enhancers.js';

// Execution engine
export { createExecutionEngine } from './execution-engine.js';
export type {
  CapabilityRequest,
  CapabilityResponse,
  SerializedError,
  InvokeFn,
  ExecutionEngineOptions,
} from './execution-engine.js';

// Plugin
export { definePlugin, mergePlugins } from './plugin.js';
export type { Plugin, MergedPlugins } from './plugin.js';

// Server
export { createServer, defineConfig } from './server.js';
export type { Transport, MountOptions, ServerConfig, Server } from './server.js';

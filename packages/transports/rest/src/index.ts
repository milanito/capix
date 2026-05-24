/**
 * index.ts — public API for capix-transport-rest
 */

export { restTransport } from './transport.js';
export type { RestTransportOptions } from './transport.js';
export { compileRouter, generateRoutes } from './router.js';
export type { RouteDefinition, RouterMatch, Router } from './router.js';

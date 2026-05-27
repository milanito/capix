/**
 * index.ts — public API for capix-transport-ws
 */

export { wsTransport } from './transport.js';
export type { WsTransportOptions } from './transport.js';
export { createEventBus } from './event-bus.js';
export type { EventBus, EventMap } from './event-bus.js';

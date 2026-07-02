/**
 * index.ts — public API for capix-transport-mcp
 */

export { mcpTransport } from './transport.js';
export type { McpTransportOptions } from './transport.js';
export { buildMcpServer, buildTools, toToolName } from './server-builder.js';
export type { McpServerOptions } from './server-builder.js';

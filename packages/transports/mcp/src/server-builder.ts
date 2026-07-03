/**
 * server-builder.ts — converts a Capix registry into an MCP server.
 *
 * Every capability becomes an MCP tool:
 *   - Dot-path names become underscore-separated tool names (users.getUser → users_getUser)
 *   - Zod input schema → tool inputSchema (JSON Schema, input side)
 *   - Zod object output schema → tool outputSchema + structuredContent
 *   - intent → tool annotations (query → readOnlyHint, delete → destructiveHint)
 *
 * Requests run through the execution engine's invoke() — guards, input
 * validation, and typed errors behave exactly as on every other transport.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { resolveIntent } from '@capixjs/core';
import type { CapabilityRegistry, InvokeFn, SerializedError } from '@capixjs/core';

export type McpServerOptions = {
  /** Server name reported during the MCP handshake. Default: 'capix'. */
  readonly name?: string;
  /** Server version reported during the MCP handshake. Default: '0.0.0'. */
  readonly version?: string;
  /** Per-call timeout in milliseconds. Default: 30 000. */
  readonly timeoutMs?: number;
};

const EMPTY_INPUT_SCHEMA = { type: 'object' as const, properties: {} };

/** users.getUser → users_getUser (MCP tool names allow [a-zA-Z0-9_-] only). */
export function toToolName(dotPath: string): string {
  return dotPath.replaceAll('.', '_');
}

/** Converts a Zod schema to JSON Schema; null when conversion fails. */
function toJsonSchema(schema: unknown, io: 'input' | 'output'): Record<string, unknown> | null {
  try {
    const js = z.toJSONSchema(schema as z.ZodType, {
      io,
      reused: 'inline',
      unrepresentable: 'any',
    }) as Record<string, unknown>;
    delete js['$schema'];
    return js;
  } catch {
    return null;
  }
}

/** Builds the tools/list payload from a compiled registry. */
export function buildTools(registry: CapabilityRegistry): { tools: Tool[]; byName: Map<string, string> } {
  const tools: Tool[] = [];
  const byName = new Map<string, string>();

  for (const [dotPath, cap] of registry) {
    const name = toToolName(dotPath);
    byName.set(name, dotPath);

    // Same rule as the REST router: explicit intent wins, otherwise inferred
    // from the capability's key name (getUser → query, deleteUser → delete).
    const key = dotPath.split('.').pop() ?? dotPath;
    const intent = resolveIntent(cap, key);

    const inputJs = cap.inputSchema !== null ? toJsonSchema(cap.inputSchema, 'input') : null;
    // MCP requires inputSchema to be an object schema. Non-object inputs
    // (z.record works; z.string() does not decompose) fall back to a
    // permissive object — the engine still validates the real schema.
    const inputSchema =
      inputJs !== null && inputJs['type'] === 'object'
        ? (inputJs as Tool['inputSchema'])
        : EMPTY_INPUT_SCHEMA;

    const outputJs = cap.outputSchema !== null ? toJsonSchema(cap.outputSchema, 'output') : null;
    const outputSchema =
      outputJs !== null && outputJs['type'] === 'object'
        ? (outputJs as Tool['outputSchema'])
        : undefined;

    tools.push({
      name,
      description: `Capix capability '${dotPath}' (intent: ${intent})`,
      inputSchema,
      ...(outputSchema !== undefined ? { outputSchema } : {}),
      annotations: {
        title: dotPath,
        readOnlyHint: intent === 'query',
        destructiveHint: intent === 'delete',
        idempotentHint: intent === 'query' || intent === 'replace' || intent === 'delete',
      },
    });
  }

  return { tools, byName };
}

function errorResult(error: SerializedError): CallToolResult {
  const issues = Array.isArray(error.meta?.['issues']) ? error.meta['issues'] : null;
  const text =
    `${error.error}: ${error.message}` +
    (issues !== null ? `\n${issues.map((i) => `- ${String(i)}`).join('\n')}` : '');
  return { content: [{ type: 'text', text }], isError: true };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Builds an MCP Server serving every capability in the registry as a tool.
 * One Server instance per MCP connection — call this once per stdio session
 * or per stateless HTTP request.
 */
export function buildMcpServer(
  registry: CapabilityRegistry,
  invoke: InvokeFn,
  options: McpServerOptions = {},
): Server {
  const { tools, byName } = buildTools(registry);
  const timeoutMs = options.timeoutMs ?? 30_000;

  const server = new Server(
    { name: options.name ?? 'capix', version: options.version ?? '0.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra): Promise<CallToolResult> => {
    const dotPath = byName.get(request.params.name);
    if (dotPath === undefined) {
      return {
        content: [{ type: 'text', text: `NotFound: unknown tool '${request.params.name}'` }],
        isError: true,
      };
    }

    // Headers reach context builders on HTTP connections; stdio has none.
    const rawHeaders = extra.requestInfo?.headers ?? {};
    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(rawHeaders)) {
      if (val !== undefined) headers[key] = Array.isArray(val) ? val.join(', ') : val;
    }

    const signal =
      typeof AbortSignal.any === 'function'
        ? AbortSignal.any([extra.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs);

    const response = await invoke({
      capability: dotPath,
      input: request.params.arguments ?? {},
      headers,
      signal,
    });

    if (!response.ok) return errorResult(response.error);

    return {
      content: [{ type: 'text', text: JSON.stringify(response.data) }],
      ...(isPlainObject(response.data) ? { structuredContent: response.data } : {}),
    };
  });

  return server;
}

/**
 * openapi.ts — generate an OpenAPI 3.1 document from a capability registry.
 *
 * Routes come from the same inference engine the REST transport uses at mount
 * time (generateRoutes), so the spec always matches what the server actually
 * serves — including urlCase and route overrides. Input schemas become path
 * parameters, query parameters (for GET/DELETE), or a JSON request body
 * (for POST/PATCH/PUT); output schemas become the `data` payload of the 200
 * response, mirroring the transport's `{ "data": ... }` envelope.
 *
 * Use programmatically:
 *   import { generateOpenAPI } from '@capixjs/transport-rest';
 *   const spec = generateOpenAPI(registry, { title: 'My API', version: '1.0.0' });
 *
 * Or via the CLI:
 *   capix openapi --output openapi.json
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CapabilityRegistry } from '@capixjs/core';
import { generateRoutes } from './router.js';
import type { HttpOverride } from './router.js';

export type OpenAPIServer = {
  readonly url: string;
  readonly description?: string;
};

export type OpenAPIOptions = {
  /** info.title — default 'Capix API'. */
  readonly title?: string;
  /** info.version — default '0.0.0'. */
  readonly version?: string;
  /** info.description. */
  readonly description?: string;
  /** servers array (e.g. [{ url: 'https://api.example.com' }]). */
  readonly servers?: ReadonlyArray<OpenAPIServer>;
  /** Case style for inferred URL segments — must match the restTransport option. */
  readonly urlCase?: 'kebab' | 'camel' | 'snake';
  /** Route overrides — must match the restTransport option for an accurate spec. */
  readonly overrides?: Record<string, HttpOverride>;
};

type JsonSchema = Record<string, unknown>;
type Operation = Record<string, unknown>;

const NO_BODY_METHODS = new Set(['GET', 'HEAD', 'DELETE']);

const ERROR_RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    error:   { type: 'string', description: 'Machine-readable error code (e.g. NotFound)' },
    message: { type: 'string', description: 'Human-readable error message' },
    meta:    { type: 'object', additionalProperties: true, description: 'Optional error details' },
  },
  required: ['error', 'message'],
};

function errorRef(description: string): Record<string, unknown> {
  return {
    description,
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/ErrorResponse' },
      },
    },
  };
}

/** Converts a Zod schema to JSON Schema; null when conversion fails. */
function toJsonSchema(schema: unknown): JsonSchema | null {
  try {
    const js = zodToJsonSchema(schema as Parameters<typeof zodToJsonSchema>[0], {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }) as JsonSchema;
    delete js['$schema'];
    return js;
  } catch {
    return null;
  }
}

function pathParamNames(routePath: string): string[] {
  const names: string[] = [];
  for (const seg of routePath.split('/')) {
    if (seg.startsWith(':')) names.push(seg.slice(1));
  }
  return names;
}

/**
 * Generates an OpenAPI 3.1 document for every capability in the registry.
 *
 * Pass the same `urlCase` and `overrides` you give to `restTransport` so the
 * generated paths match the running server.
 */
export function generateOpenAPI(
  registry: CapabilityRegistry,
  options: OpenAPIOptions = {},
): Record<string, unknown> {
  const routes = generateRoutes(registry, {
    ...(options.urlCase !== undefined ? { urlCase: options.urlCase } : {}),
    ...(options.overrides !== undefined ? { overrides: options.overrides } : {}),
  });

  const paths: Record<string, Record<string, Operation>> = {};
  const tags = new Set<string>();

  for (const route of routes) {
    const cap = registry.get(route.capability);
    if (cap === undefined) continue;

    const openapiPath = route.path.replace(/:([^/]+)/g, '{$1}');
    const params = pathParamNames(route.path);
    const paramSet = new Set(params);

    const inputJs = cap.inputSchema !== null ? toJsonSchema(cap.inputSchema) : null;
    const properties = (inputJs?.['properties'] ?? {}) as Record<string, JsonSchema>;
    const requiredFields = new Set((inputJs?.['required'] ?? []) as string[]);
    // Object schemas split into parameters/body; non-object schemas (z.record,
    // z.any) can't be decomposed — they become the whole request body.
    const isObjectSchema = inputJs !== null && 'properties' in inputJs;

    const parameters: Record<string, unknown>[] = [];
    for (const name of params) {
      parameters.push({
        name,
        in: 'path',
        required: true,
        schema: properties[name] ?? { type: 'string' },
      });
    }

    let requestBody: Record<string, unknown> | null = null;

    if (NO_BODY_METHODS.has(route.method)) {
      // Remaining schema fields are query parameters
      for (const [name, schema] of Object.entries(properties)) {
        if (paramSet.has(name)) continue;
        parameters.push({
          name,
          in: 'query',
          required: requiredFields.has(name),
          schema,
        });
      }
    } else if (isObjectSchema) {
      const bodyProps: Record<string, JsonSchema> = {};
      const bodyRequired: string[] = [];
      for (const [name, schema] of Object.entries(properties)) {
        if (paramSet.has(name)) continue;
        bodyProps[name] = schema;
        if (requiredFields.has(name)) bodyRequired.push(name);
      }
      if (Object.keys(bodyProps).length > 0) {
        requestBody = {
          required: bodyRequired.length > 0,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: bodyProps,
                ...(bodyRequired.length > 0 ? { required: bodyRequired } : {}),
              },
            },
          },
        };
      }
    } else if (inputJs !== null) {
      requestBody = {
        required: true,
        content: { 'application/json': { schema: inputJs } },
      };
    }

    const outputJs = cap.outputSchema !== null ? toJsonSchema(cap.outputSchema) : null;

    const responses: Record<string, unknown> = {
      '200': {
        description: 'Success',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { data: outputJs ?? {} },
              required: ['data'],
            },
          },
        },
      },
      ...(cap.inputSchema !== null ? { '400': errorRef('Validation error') } : {}),
      default: errorRef('Error'),
    };

    const segments = route.capability.split('.');
    const group = segments.length > 1 ? segments[0]! : null;
    if (group !== null) tags.add(group);

    const operation: Operation = {
      operationId: route.capability.replaceAll('.', '_'),
      summary: route.capability,
      ...(group !== null ? { tags: [group] } : {}),
      ...(parameters.length > 0 ? { parameters } : {}),
      ...(requestBody !== null ? { requestBody } : {}),
      responses,
    };

    if (!(openapiPath in paths)) paths[openapiPath] = {};
    paths[openapiPath]![route.method.toLowerCase()] = operation;
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Capix API',
      version: options.version ?? '0.0.0',
      ...(options.description !== undefined ? { description: options.description } : {}),
    },
    ...(options.servers !== undefined && options.servers.length > 0
      ? { servers: options.servers }
      : {}),
    paths,
    components: { schemas: { ErrorResponse: ERROR_RESPONSE_SCHEMA } },
    ...(tags.size > 0 ? { tags: [...tags].sort().map((name) => ({ name })) } : {}),
  };
}

/**
 * schema-builder.ts — Converts a Capix registry into a GraphQL schema.
 *
 * Rules:
 *   - effective intent 'query' (explicit, or inferred from the key name via
 *     resolveIntent — same rule as REST routing) → Query field
 *   - all other intents → Mutation field
 *   - Dot-path names become underscore-separated field names (users.getUser → users_getUser)
 *   - Zod input schema fields → individual GraphQL args
 *   - Zod output schema → named GraphQL output type; absent → JSONScalar
 *   - Type cache prevents duplicate type definitions across fields
 */

import {
  GraphQLSchema,
  GraphQLObjectType,
  GraphQLInputObjectType,
  GraphQLString,
  GraphQLFloat,
  GraphQLBoolean,
  GraphQLList,
  GraphQLNonNull,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLError,
  Kind,
} from 'graphql';
import type { GraphQLOutputType, GraphQLInputType, GraphQLFieldConfig } from 'graphql';
import { resolveIntent } from '@capixjs/core';
import type { CapabilityRegistry, InvokeFn } from '@capixjs/core';

export const JSONScalar = new GraphQLScalarType({
  name: 'JSON',
  description: 'Arbitrary JSON value',
  serialize: (v) => v,
  parseValue: (v) => v,
  parseLiteral: (ast) => {
    switch (ast.kind) {
      case Kind.INT:     return parseInt(ast.value, 10);
      case Kind.FLOAT:   return parseFloat(ast.value);
      case Kind.STRING:  return ast.value;
      case Kind.BOOLEAN: return ast.value;
      case Kind.NULL:    return null;
      default:           return null;
    }
  },
});

type GQLContext = { readonly headers: Record<string, string> };
type OutputTypeCache = Map<string, GraphQLObjectType>;
type InputTypeCache = Map<string, GraphQLInputObjectType>;
/** Zod 4 internal def — schema._zod.def (see zod's library-authors guide). */
type ZodDef = {
  type?: string;
  innerType?: unknown;
  in?: unknown;       // pipe (.transform()) input side
  element?: unknown;  // array element
  shape?: Record<string, unknown>;
  entries?: Record<string, unknown>; // enum values
};

function zodDef(schema: unknown): ZodDef {
  return (schema as { _zod?: { def?: ZodDef } })?._zod?.def ?? {};
}

function resolveShape(d: ZodDef): Record<string, unknown> {
  return d.shape ?? {};
}

function zodToGqlOutput(schema: unknown, typeName: string, cache: OutputTypeCache): GraphQLOutputType {
  const d = zodDef(schema);
  switch (d.type) {
    case 'string': return new GraphQLNonNull(GraphQLString);
    case 'number': return new GraphQLNonNull(GraphQLFloat);
    case 'boolean': return new GraphQLNonNull(GraphQLBoolean);
    case 'default':
    case 'prefault': {
      // Unwrap default — value is optional in GraphQL (no NonNull)
      const inner = zodToGqlOutput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLOutputType) : inner;
    }
    case 'pipe':
      // .transform() / z.preprocess() — unwrap to the base schema
      return zodToGqlOutput(d.in, typeName, cache);
    case 'optional':
    case 'nullable': {
      const inner = zodToGqlOutput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLOutputType) : inner;
    }
    case 'array': {
      const inner = zodToGqlOutput(d.element, `${typeName}Item`, cache);
      return new GraphQLNonNull(new GraphQLList(inner));
    }
    case 'object': {
      const cached = cache.get(typeName);
      if (cached) return new GraphQLNonNull(cached);
      const shape = resolveShape(d);
      const objectType = new GraphQLObjectType({
        name: typeName,
        fields: () => {
          const fields: Record<string, GraphQLFieldConfig<unknown, GQLContext>> = {};
          for (const [key, val] of Object.entries(shape)) {
            fields[key] = { type: zodToGqlOutput(val, `${typeName}_${key}`, cache) };
          }
          return fields;
        },
      });
      cache.set(typeName, objectType);
      return new GraphQLNonNull(objectType);
    }
    case 'enum': {
      const valList = Object.values(d.entries ?? {});
      const enumValues: Record<string, { value: string }> = {};
      for (const v of valList) enumValues[String(v)] = { value: String(v) };
      return new GraphQLNonNull(new GraphQLEnumType({ name: typeName, values: enumValues }));
    }
    case 'any':
    case 'unknown':
    default:
      return JSONScalar;
  }
}

function zodToGqlInput(schema: unknown, typeName: string, cache: InputTypeCache): GraphQLInputType {
  const d = zodDef(schema);
  switch (d.type) {
    case 'string': return new GraphQLNonNull(GraphQLString);
    case 'number': return new GraphQLNonNull(GraphQLFloat);
    case 'boolean': return new GraphQLNonNull(GraphQLBoolean);
    case 'default':
    case 'prefault': {
      // Unwrap default — field is optional in GraphQL (no NonNull)
      const inner = zodToGqlInput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLInputType) : inner;
    }
    case 'pipe':
      // .transform() / z.preprocess() — unwrap to the base schema
      return zodToGqlInput(d.in, typeName, cache);
    case 'optional':
    case 'nullable': {
      const inner = zodToGqlInput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLInputType) : inner;
    }
    case 'array': {
      const inner = zodToGqlInput(d.element, `${typeName}Item`, cache);
      return new GraphQLNonNull(new GraphQLList(inner));
    }
    case 'object': {
      const cached = cache.get(typeName);
      if (cached) return new GraphQLNonNull(cached);
      const shape = resolveShape(d);
      const inputType = new GraphQLInputObjectType({
        name: typeName,
        fields: () => {
          const fields: Record<string, { type: GraphQLInputType }> = {};
          for (const [key, val] of Object.entries(shape)) {
            fields[key] = { type: zodToGqlInput(val, `${typeName}_${key}`, cache) };
          }
          return fields;
        },
      });
      cache.set(typeName, inputType);
      return new GraphQLNonNull(inputType);
    }
    case 'enum': {
      const valList = Object.values(d.entries ?? {});
      const enumValues: Record<string, { value: string }> = {};
      for (const v of valList) enumValues[String(v)] = { value: String(v) };
      return new GraphQLNonNull(new GraphQLEnumType({ name: `${typeName}Enum`, values: enumValues }));
    }
    case 'any':
    case 'unknown':
    default:
      return JSONScalar;
  }
}

function toTypeName(dotPath: string): string {
  return dotPath.split(/[._]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

export function buildGraphQLSchema(registry: CapabilityRegistry, invoke: InvokeFn): GraphQLSchema {
  const outputCache: OutputTypeCache = new Map();
  const inputCache: InputTypeCache = new Map();
  const queryFields: Record<string, GraphQLFieldConfig<unknown, GQLContext>> = {};
  const mutationFields: Record<string, GraphQLFieldConfig<unknown, GQLContext>> = {};

  for (const [name, cap] of registry) {
    const fnName = name.replaceAll('.', '_');
    const typeName = toTypeName(name);

    const args: Record<string, { type: GraphQLInputType }> = {};
    if (cap.inputSchema !== null) {
      const shape = resolveShape(zodDef(cap.inputSchema));
      for (const [key, val] of Object.entries(shape)) {
        args[key] = { type: zodToGqlInput(val, `${typeName}_${key}Input`, inputCache) };
      }
    }

    const returnType: GraphQLOutputType = cap.outputSchema !== null
      ? zodToGqlOutput(cap.outputSchema, `${typeName}Output`, outputCache)
      : JSONScalar;

    const field: GraphQLFieldConfig<unknown, GQLContext> = {
      type: returnType,
      args,
      resolve: async (_root, resolvedArgs, context) => {
        const signal = AbortSignal.timeout(30_000);
        const response = await invoke({
          capability: name,
          input: resolvedArgs,
          headers: context?.headers ?? {},
          signal,
        });
        if (!response.ok) {
          // Preserve the typed FrameworkError shape in GraphQL extensions so
          // clients can branch on `extensions.code` / `extensions.status`
          // instead of parsing the message string.
          const { status, error, message, meta } = response.error;
          throw new GraphQLError(message, {
            extensions: {
              code: error,
              status,
              ...(meta !== undefined ? { meta } : {}),
            },
          });
        }
        return response.data;
      },
    };

    // Same rule as REST routing and MCP annotations: explicit intent wins,
    // otherwise inferred from the key name (getUser → Query field).
    const key = name.split('.').pop() ?? name;
    if (resolveIntent(cap, key) === 'query') {
      queryFields[fnName] = field;
    } else {
      mutationFields[fnName] = field;
    }
  }

  // GraphQL requires at least one field in Query
  if (Object.keys(queryFields).length === 0) {
    queryFields['_empty'] = { type: GraphQLString, resolve: () => 'empty' };
  }

  return new GraphQLSchema({
    query: new GraphQLObjectType({ name: 'Query', fields: queryFields }),
    ...(Object.keys(mutationFields).length > 0
      ? { mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutationFields }) }
      : {}),
  });
}

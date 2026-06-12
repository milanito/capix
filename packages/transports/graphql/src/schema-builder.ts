/**
 * schema-builder.ts — Converts a Capix registry into a GraphQL schema.
 *
 * Rules:
 *   - intent: 'query'  → Query field
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
type ZodDef = {
  typeName?: string;
  innerType?: unknown;
  schema?: unknown;   // ZodEffects inner schema
  shape?: (() => Record<string, unknown>) | Record<string, unknown>;
  type?: unknown;
  values?: string[];
};

function zodDef(schema: unknown): ZodDef {
  return (schema as { _def?: ZodDef })?._def ?? {};
}

function resolveShape(d: ZodDef): Record<string, unknown> {
  return typeof d.shape === 'function' ? d.shape() : (d.shape ?? {});
}

function zodToGqlOutput(schema: unknown, typeName: string, cache: OutputTypeCache): GraphQLOutputType {
  const d = zodDef(schema);
  switch (d.typeName) {
    case 'ZodString': return new GraphQLNonNull(GraphQLString);
    case 'ZodNumber': return new GraphQLNonNull(GraphQLFloat);
    case 'ZodBoolean': return new GraphQLNonNull(GraphQLBoolean);
    case 'ZodDefault': {
      // Unwrap default — value is optional in GraphQL (no NonNull)
      const inner = zodToGqlOutput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLOutputType) : inner;
    }
    case 'ZodEffects':
      // z.coerce.* and z.preprocess() — unwrap to inner schema
      return zodToGqlOutput(d.schema, typeName, cache);
    case 'ZodOptional':
    case 'ZodNullable': {
      const inner = zodToGqlOutput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLOutputType) : inner;
    }
    case 'ZodArray': {
      const inner = zodToGqlOutput(d.type, `${typeName}Item`, cache);
      return new GraphQLNonNull(new GraphQLList(inner));
    }
    case 'ZodObject': {
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
    case 'ZodEnum': {
      const valList = d.values ?? [];
      const enumValues: Record<string, { value: string }> = {};
      for (const v of valList) enumValues[String(v)] = { value: String(v) };
      return new GraphQLNonNull(new GraphQLEnumType({ name: typeName, values: enumValues }));
    }
    case 'ZodAny':
    case 'ZodUnknown':
    default:
      return JSONScalar;
  }
}

function zodToGqlInput(schema: unknown, typeName: string, cache: InputTypeCache): GraphQLInputType {
  const d = zodDef(schema);
  switch (d.typeName) {
    case 'ZodString': return new GraphQLNonNull(GraphQLString);
    case 'ZodNumber': return new GraphQLNonNull(GraphQLFloat);
    case 'ZodBoolean': return new GraphQLNonNull(GraphQLBoolean);
    case 'ZodDefault': {
      // Unwrap default — field is optional in GraphQL (no NonNull)
      const inner = zodToGqlInput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLInputType) : inner;
    }
    case 'ZodEffects':
      // z.coerce.* and z.preprocess() — unwrap to inner schema
      return zodToGqlInput(d.schema, typeName, cache);
    case 'ZodOptional':
    case 'ZodNullable': {
      const inner = zodToGqlInput(d.innerType, typeName, cache);
      return inner instanceof GraphQLNonNull ? (inner.ofType as GraphQLInputType) : inner;
    }
    case 'ZodArray': {
      const inner = zodToGqlInput(d.type, `${typeName}Item`, cache);
      return new GraphQLNonNull(new GraphQLList(inner));
    }
    case 'ZodObject': {
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
    case 'ZodEnum': {
      const valList = d.values ?? [];
      const enumValues: Record<string, { value: string }> = {};
      for (const v of valList) enumValues[String(v)] = { value: String(v) };
      return new GraphQLNonNull(new GraphQLEnumType({ name: `${typeName}Enum`, values: enumValues }));
    }
    case 'ZodAny':
    case 'ZodUnknown':
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

    if (cap.intent === 'query') {
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

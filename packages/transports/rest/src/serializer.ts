/**
 * serializer.ts — compile fast-json-stringify serializers from Zod output schemas.
 *
 * Replaces the generic `JSON.stringify` call in the response path with a schema-compiled
 * serializer for capabilities that declare an outputSchema. Compiled at mount time; zero
 * per-request setup cost.
 */

import fastJsonStringify from 'fast-json-stringify';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CapabilityRegistry } from '@capixjs/core';

/** Pre-compiled response serializer: data → '{"data":<json>}' */
export type ResponseSerializer = (data: unknown) => string;

const DEFAULT: ResponseSerializer = (data) => '{"data":' + JSON.stringify(data) + '}';

export { DEFAULT as defaultSerializer };

/**
 * Builds per-capability serializers from compiled output schemas.
 * Falls back to JSON.stringify for capabilities without an outputSchema or
 * if zod-to-json-schema cannot convert the schema.
 */
export function buildSerializers(registry: CapabilityRegistry): Map<string, ResponseSerializer> {
  const map = new Map<string, ResponseSerializer>();

  for (const [dotPath, cap] of registry) {
    if (cap.outputSchema === null) continue;

    try {
      const jsonSchema = zodToJsonSchema(cap.outputSchema, {
        target: 'jsonSchema7',
        $refStrategy: 'none',
      });
      // Remove the $schema meta field — fjs doesn't need it
      if (typeof jsonSchema === 'object' && jsonSchema !== null) {
        delete (jsonSchema as Record<string, unknown>)['$schema'];
      }

      const serializeData = fastJsonStringify(jsonSchema as Parameters<typeof fastJsonStringify>[0]);
      map.set(dotPath, (data) => '{"data":' + serializeData(data) + '}');
    } catch {
      // Schema type not supported by fjs (e.g. z.union with discriminants); fall back to JSON.stringify.
    }
  }

  return map;
}

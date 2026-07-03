import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Pin graphql to its CJS entry so the schema built inside
    // @capixjs/transport-graphql and the graphql-http handler share one
    // module instance. Without this, vite resolves the ESM copy for part of
    // the graph while graphql-http (externalized CJS) loads the CJS copy —
    // two realms, and graphql-http rejects the schema. Plain node never
    // hits this; it is a vitest/vite resolution artifact.
    alias: {
      graphql: 'graphql/index.js',
    },
  },
  test: {
    include: ['**/*.test.ts'],
    testTimeout: 15000,
  },
});

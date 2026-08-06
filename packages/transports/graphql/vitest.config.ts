import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Pin graphql to its CJS entry so the schema built by buildGraphQLSchema
    // and the graphql-http handler share one module instance. Without this,
    // vite resolves the ESM copy for part of the graph while graphql-http
    // (externalized CJS) loads the CJS copy — two realms, and graphql-http
    // rejects the schema with "Cannot use GraphQLSchema ... from another
    // module or realm". Plain node never hits this; it is a vitest/vite
    // resolution artifact. See test/integration/vitest.config.ts for the
    // same fix applied there.
    alias: {
      graphql: 'graphql/index.js',
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});

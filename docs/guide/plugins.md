# Plugins

Plugins bundle capabilities and context extensions into a reusable, composable unit.

## Defining a plugin

```ts
import { definePlugin } from '@capixjs/core';

const auditPlugin = definePlugin({
  // Add capabilities to the server registry
  capabilities: {
    audit: { getLogs, clearLogs },
  },
  // Extend the context for every request
  context: (base) => ({
    ...base,
    auditLog: new AuditLogger(base.requestId),
  }),
});
```

Both `capabilities` and `context` are optional. A plugin that only adds capabilities (no context extension) or only adds context (no capabilities) is valid.

## Using plugins

```ts
import { createServer } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';

createServer({
  context:      buildContext,
  capabilities: { users: { getUser, createUser } },
  plugins: [auditPlugin],
  transports: [restTransport({ port: 3000 })],
}).start();
```

Plugins (the `definePlugin()` kind on this page) are merged at server creation. Their capabilities are merged into the registry alongside the server-level `capabilities`. Their context extensions are composed in order.

**`@capixjs/plugin-cors`, `@capixjs/plugin-helmet`, and `@capixjs/plugin-logging` are not `definePlugin()` plugins** — don't pass them to `plugins: [...]`. CORS and security headers are REST-transport concerns, so `cors()`/`helmet()` return partial `RestTransportOptions` meant to be spread into `restTransport()` directly:

```ts
import { cors } from '@capixjs/plugin-cors';
import { helmet, mergeHooks } from '@capixjs/plugin-helmet';

restTransport({
  port: 3000,
  ...mergeHooks(
    cors({ origin: 'https://app.example.com' }),
    helmet(),
  ),
})
```

`@capixjs/plugin-logging`'s `loggingEnhancer()` isn't request-scoped either — it wraps individual capabilities via `.enhance(loggingEnhancer())`, since there's no capability-registry hook that runs on every request. See each package's README for full options.

## Plugin composition order

Context extensions run after `buildContext` in plugin array order:

```ts
plugins: [pluginA, pluginB]
// context = pluginB.context(pluginA.context(buildContext(req)))
```

Later plugins see context added by earlier plugins.

## Plugin capabilities

Plugin capabilities are registered at the root of the registry alongside server-level capabilities. A plugin's `users` group merges with the server's `users` group (no collision allowed — throw on duplicate keys).

## Shipping plugins

Plugins are plain TypeScript objects. To package one for npm:

```ts
// my-plugin/src/index.ts
import { definePlugin } from '@capixjs/core';

export function myPlugin(options: MyPluginOptions) {
  return definePlugin({
    capabilities: {
      myFeature: { doSomething: createDoSomething(options) },
    },
    context: (base) => ({
      ...base,
      myService: new MyService(options),
    }),
  });
}
```

```json
// my-plugin/package.json
{
  "peerDependencies": {
    "capix": ">=0.1.0-0"
  }
}
```

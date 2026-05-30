# Plugins

Plugins bundle capabilities and context extensions into a reusable, composable unit.

## Defining a plugin

```ts
import { definePlugin } from 'capix';

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
import { createServer } from 'capix';
import { restTransport } from 'capix-transport-rest';
import { corsPlugin } from 'capix-plugin-cors';
import { helmetPlugin } from 'capix-plugin-helmet';
import { loggingPlugin } from 'capix-plugin-logging';

createServer({
  context:      buildContext,
  capabilities: { users: { getUser, createUser } },
  plugins: [
    corsPlugin({ origin: 'https://app.example.com', credentials: true }),
    helmetPlugin(),
    loggingPlugin({ level: 'info' }),
    auditPlugin,
  ],
  transports: [restTransport({ port: 3000 })],
}).start();
```

Plugins are merged at server creation. Their capabilities are merged into the registry alongside the server-level `capabilities`. Their context extensions are composed in order.

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
import { definePlugin } from 'capix';

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

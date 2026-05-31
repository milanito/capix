# Context

Context is built once per request and passed to every guard and resolver for that request.

## Defining context

```ts
import { defineContext, getHeader } from '@capixjs/core';

const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user:      await verifyToken(getHeader(req, 'authorization')),
  db,
  logger:    pino({ level: 'info' }),
}));
```

`defineContext` accepts a function `(req: RawRequest) => Context | Promise<Context>`. The `RawRequest` type is:

```ts
type RawRequest = {
  headers: Record<string, string | string[] | undefined>;
};
```

Use `getHeader(req, name)` for type-safe access — it returns `string | undefined` regardless of whether the header is a string or array.

## Typed factories

Once you have a context type, create typed capability factories:

```ts
import { capability } from '@capixjs/core';

export type AppContext = Awaited<ReturnType<typeof buildContext>>;

export const cap     = capability.withContext<AppContext>();
export const authCap = capability.withContext<AppContext & { user: NonNullable<AppContext['user']> }>();
```

All capabilities created with `cap` or `authCap` will have `ctx` typed as `AppContext`.

## Sync vs async

`buildContext` can be synchronous. The execution engine detects sync context builders and skips the async path for a small performance gain:

```ts
// Sync — slightly faster hot path
const buildContext = defineContext((req) => ({
  requestId: crypto.randomUUID(),
  user:      headerToUser(req.headers.authorization),
}));
```

## Context per transport

The same `buildContext` is called for every transport. For queue-originated jobs, headers will be minimal (no real `Authorization`). If you need per-transport context differences, check the headers defensively:

```ts
const buildContext = defineContext(async (req) => {
  const serviceKey = getHeader(req, 'x-service-key');
  const user = serviceKey === process.env.QUEUE_SECRET
    ? SERVICE_ACCOUNT
    : await verifyJwt(getHeader(req, 'authorization'));
  return { requestId: crypto.randomUUID(), user, db };
});
```

## Plugin context extension

Plugins can extend the context. The extended context is merged into every request's context:

```ts
import { definePlugin } from '@capixjs/core';

const metricsPlugin = definePlugin({
  context: (base) => ({
    ...base,
    metrics: new MetricsClient(),
  }),
});

createServer({
  context: buildContext,
  plugins:  [metricsPlugin],
  ...
});
```

Plugin extensions are applied after `buildContext` and before guards run.

## BaseContext

`BaseContext` is the minimum type all contexts must extend:

```ts
type BaseContext = {
  requestId: string;
};
```

`defineContext` enforces this — your returned object must include `requestId`.

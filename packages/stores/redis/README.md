# @capixjs/store-redis

Redis-backed stores for [Capix](https://github.com/milanito/capix) enhancers. The in-memory defaults of `withCache` and `withRateLimit` are per-process — behind a load balancer each instance caches independently and N instances enforce N× the intended rate limit. These stores share state through Redis so both behave correctly across instances.

## Install

```bash
npm install @capixjs/store-redis ioredis
```

No Redis library is bundled — pass any client with an ioredis-compatible surface (`get` / `set(key, value, 'PX', ms)` / `eval`).

## Usage

```ts
import Redis from 'ioredis';
import { withCache, withRateLimit } from '@capixjs/core';
import { redisCacheStore, redisRateLimitStore } from '@capixjs/store-redis';

const redis = new Redis(process.env.REDIS_URL);

const getStats = capability(schema, resolver)
  .enhance(withCache(30, { store: redisCacheStore(redis) }));

const createPost = capability(schema, resolver)
  .enhance(withRateLimit({
    limit: 100,
    windowMs: 60_000,
    keyFn: (_input, ctx) => ctx.user?.id ?? 'anon',
    store: redisRateLimitStore(redis),
  }));
```

## Semantics

- **Cache** — values are JSON-serialized under `capix:cache:<key>` with Redis-native expiry (`PX`). Unparseable/foreign entries read as misses.
- **Rate limit** — an atomic Lua script (`INCR` + `PEXPIRE` on first hit + `PTTL`) implements a **fixed window**: the counter resets `windowMs` after the window's first hit. One round-trip per request; concurrent hits across instances cannot race past the limit. (The in-memory default uses a sliding window — expect slightly different edge behavior at window boundaries.)
- **Prefix** — pass `{ prefix: 'myapp:' }` so multiple apps can share one Redis.

## node-redis

node-redis v4 has a different `set`/`eval` signature; adapt with a thin wrapper:

```ts
const client = createClient({ url: process.env.REDIS_URL });
const adapted = {
  get: (k: string) => client.get(k),
  set: (k: string, v: string, _px: 'PX', ms: number) => client.set(k, v, { PX: ms }),
  eval: (script: string, _n: number, key: string, ...args: (string | number)[]) =>
    client.eval(script, { keys: [key], arguments: args.map(String) }),
};
```

## Cross-instance event bus

The in-memory event bus delivers only within one process — an event published on instance A never reaches WebSocket clients connected to instance B. `createRedisEventBus` routes events through Redis pub/sub so every instance receives every event:

```ts
import Redis from 'ioredis';
import { createRedisEventBus } from '@capixjs/store-redis';

// Redis pub/sub needs a dedicated subscriber connection
const events = createRedisEventBus<AppEvents>(
  new Redis(process.env.REDIS_URL),  // publisher
  new Redis(process.env.REDIS_URL),  // subscriber
);

// Drop-in wherever a bus is accepted:
wsTransport({ port: 3001, eventBus: events });
// in a resolver on ANY instance:
events.publish('order:paid', { orderId });
```

Semantics: the publishing instance receives its own events via the broker round-trip (uniform ordering everywhere); payloads are JSON-serialized; publish failures are logged, never thrown into the publisher — same fire-and-forget contract as the in-memory bus. Pass `{ prefix }` to isolate apps sharing one Redis.

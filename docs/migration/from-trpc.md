# Migrating from tRPC

Of the three migration guides, this is the shortest gap to close. tRPC procedures and Capix capabilities are the same idea: a schema-validated input, a typed resolver, no separate route file. If you've used tRPC, most of this guide will read as "same thing, different name." The differences that matter are at the edges — how the result gets to a client, and what a client is.

## Procedure vs. capability

```ts
// tRPC
export const appRouter = t.router({
  getUser: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const user = await db.users.find(input.id);
      if (!user) throw new TRPCError({ code: 'NOT_FOUND' });
      return user;
    }),
});

// Capix
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
);
```

Both validate `input` with the same Zod schema before the function body runs, and both give you `input` typed and parsed with no cast. The difference is what happens after: a tRPC procedure is only reachable through tRPC's own client and wire protocol (or an HTTP adapter you configure by hand). A Capix capability is reachable from REST, WebSocket, GraphQL, a queue, and MCP simultaneously, unchanged — there's no tRPC-equivalent client protocol to opt into; every transport speaks its own standard wire format (plain JSON over HTTP, GraphQL over HTTP, an MCP tool call).

`.query()` vs `.mutation()` is explicit in tRPC; in Capix it's the third argument (`'query'`) — or inferred from the key name entirely (`getUser` → query, `createUser` → mutation) if you leave it off. Both exist for the same reason: REST needs to know GET vs. POST, and GraphQL needs to know Query vs. Mutation type placement.

## Routers vs. groups

```ts
// tRPC
const usersRouter = t.router({
  list:   publicProcedure.query(listUsers),
  get:    publicProcedure.input(z.object({ id: z.string() })).query(getUser),
  create: publicProcedure.input(createUserInput).mutation(createUser),
});

export const appRouter = t.router({
  users: usersRouter,
  posts: postsRouter,
});

// Capix
const capabilities = {
  users: { list: listUsers, get: getUser, create: createUser },
  posts: postsCapabilities,
};
```

Structurally identical — a plain object of routers/groups nests the same way a plain object of capabilities does. `t.router({...})` is a real function call that does some setup; a Capix group is just an object literal with no wrapper at all. Nesting depth is unlimited in both; Capix flattens it into dot-path names (`users.get`) at registry-compile time, which is also what shows up in REST routes, GraphQL field names (`users_get`), and MCP tool names.

## Middleware and protected procedures

This is where tRPC and Capix converge the most, and it's worth spending time on because tRPC's own idiomatic pattern is the one Capix spent effort *getting away from*.

```ts
// tRPC
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { user: ctx.user } }); // ctx.user is now non-null downstream
});

export const publicProcedure    = t.procedure;
export const protectedProcedure = publicProcedure.use(isAuthed);

const getProfile = protectedProcedure.query(({ ctx }) => ctx.user);
```

If that `publicProcedure` / `protectedProcedure` split looks familiar, it's because it's exactly the shape of Capix's older two-factory pattern (`cap` / `authCap`, still valid, still documented in [TypeScript workarounds](../ts-workarounds.md)) — both exist to solve the identical problem: TypeScript can't narrow a resolver's context type from a check applied *after* the resolver is written, so both frameworks pre-declare a separately-typed builder for the narrowed case.

Capix's current recommendation goes one step further than tRPC does here — guards declared *before* the resolver, no second builder to define or export at all:

```ts
// Capix
const mustBeUser = defineGuard((ctx: AppContext): asserts ctx is AppContext & { user: User } => {
  if (!ctx.user) throw errors.Unauthorized();
});

const getProfile = capability.guard(mustBeUser)(
  z.object({}),
  async (_, ctx) => ctx.user, // ctx.user: User, not User | null — no protectedProcedure needed
  'query',
);
```

`capability.guard(g1).guard(g2)(...)` chains the same way `.use(m1).use(m2)` does, narrowing further at each step. The mechanical difference: tRPC's `next({ ctx })` merges whatever you pass into the existing context; a Capix guard uses a TypeScript assertion (`asserts ctx is ...`) instead of a return value — the guard doesn't build a new context object, it proves something about the one that already exists (or throws). Neither approach re-runs earlier middleware/guards in the chain when a later one is checked.

## Errors

```ts
// tRPC
throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
// code maps to an HTTP status via getHTTPStatusCodeFromError — NOT_FOUND → 404

// Capix
const errors = { NotFound: defineError(404, 'User not found') };
throw errors.NotFound();
// same shape on every transport: { error: 'NotFound', message: 'User not found' }
```

The shapes are close: both are a fixed vocabulary of typed errors rather than throwing bare `Error`s. The difference is what the vocabulary is keyed on. tRPC's `code` is one of a fixed enum (`UNAUTHORIZED`, `NOT_FOUND`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`, …) that a lookup table translates to an HTTP status. `defineError` takes the HTTP status directly and derives a `PascalCase` error code from the message (or accepts one explicitly) — there's no fixed enum to pick from, and the same declared error automatically becomes the WebSocket `ok: false` status, the GraphQL `errors[].extensions.status`, and the MCP `isError` text, not just an HTTP response.

## Output validation

```ts
// tRPC — validates and strips unknown fields from every response
const getUser = publicProcedure
  .input(z.object({ id: z.string() }))
  .output(z.object({ id: z.string(), name: z.string() }))
  .query(({ input }) => db.users.find(input.id));

// Capix
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => db.users.find(id),
  'query',
).output(z.object({ id: z.string(), name: z.string() }));
```

Same method name, same idea — a second schema that checks (and, in tRPC's case, strips) what the resolver actually returns. The behavior differs in one way worth knowing before you rely on it: Capix only runs `.output()` validation when the server is started with `isDevelopment: true` — it's a development-time safety net for catching resolver bugs, not an always-on production check (there's no field-stripping in production either; the resolver's actual return value goes out as-is). If you want tRPC's always-validated behavior, that's what it costs to add — validate explicitly in the resolver itself, or gate `isDevelopment` on more than just your local environment.

## Type-safe clients

This is the one place the comparison actually favors tRPC, and it's worth being direct about it rather than glossing over it.

```ts
// tRPC — no codegen. The client imports the server's router TYPE directly.
import type { AppRouter } from '../server/router';
import { createTRPCClient, httpBatchLink } from '@trpc/client';

const client = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: 'http://localhost:3000/trpc' })],
});

const user = await client.users.get.query({ id: '1' }); // user: { id: string; name: string }, fully inferred
```

```bash
# Capix — generates an actual client file, once, ahead of time
capix client --output src/client.ts --base-url http://localhost:3000
```

```ts
// src/client.ts (generated)
export async function users_get(id: string): Promise<unknown> {
  return request('GET', `/users/${id}`);
}
```

tRPC's client requires zero code generation: it imports the server's `AppRouter` *type* (a `type`-only import, erased at build time) and TypeScript infers every input and output from it directly, live, as the server code changes — this only works because both sides are TypeScript in a setup where that type import can resolve (same repo, or a published `@types`-style package).

`capix client` generates a real file you commit, and only inputs are typed — path/body/query parameters come from the capability's Zod input schema, so `id: string` above is real. **The return type is `unknown`**, not the capability's actual output shape; the CLI does not currently read `.output()` schemas (or infer resolver return types) into the generated client. If you're in the same TypeScript project as the server, importing `InferOutput<typeof getUser>` from `@capixjs/core` alongside the generated function is the closest workaround today; there's no live-inference path like tRPC's.

## Batching

tRPC's `httpBatchLink` automatically collects multiple procedure calls made in the same tick into a single HTTP request. Capix has no equivalent — every REST call is its own HTTP request. If a client needs to fetch several things at once, either design one capability that returns all of them, or make the requests concurrently (`Promise.all`) and accept the extra round trips.

## Subscriptions

```ts
// tRPC
onTaskUpdated: publicProcedure.subscription(async function* () {
  for await (const event of eventEmitter) yield event;
}),

// Capix — an event bus, not a per-procedure subscription
export const eventBus = createEventBus<{ 'task:updated': Task }>();
// in a mutation's resolver:
eventBus.publish('task:updated', task);
// wsTransport({ eventBus }) delivers it to clients subscribed via a WS message
```

Both end up pushing server-initiated events to connected clients, but the shape is different. A tRPC subscription is itself a procedure — the client calls it like any other, gets an async iterator, and tRPC's WebSocket link manages the connection. A Capix event bus is a separate primitive: any capability publishes to it (typically a mutation, after a write succeeds), and WebSocket clients subscribe to named events with a `{ action: 'subscribe', event }` message rather than calling a capability. See the [real-time pattern](../patterns/real-time.md) for the full setup, including per-client filtering.

## Reference table

| tRPC | Capix |
|---|---|
| `publicProcedure.input(schema).query(fn)` | `capability(schema, resolver, 'query')` |
| `publicProcedure.input(schema).mutation(fn)` | `capability(schema, resolver)` (or `'mutation'` explicit) |
| `t.router({ users: usersRouter })` | group object `{ users: { ... } }` |
| `t.middleware((opts) => opts.next({ ctx }))` | `.guard(fn)` (asserts, not a returned ctx merge) |
| `protectedProcedure = publicProcedure.use(isAuthed)` | `capability.guard(mustBeUser)(...)` — no second builder needed |
| `new TRPCError({ code, message })` | `throw defineError(status, message)()` |
| `.output(schema)` | `.output(schema)` — dev-only by default, see above |
| `createTRPCClient<AppRouter>()` (live inference) | `capix client` (generated file, inputs typed, outputs `unknown`) |
| `httpBatchLink` (automatic request batching) | not available — one capability call, one request |
| `publicProcedure.subscription(fn)` | `createEventBus()` + `wsTransport({ eventBus })` |
| `createContext` | `defineContext` |
| tRPC has no non-HTTP/WS transport | GraphQL, queue, and MCP transports read the same registry |

## What Capix cannot replace

- **Live end-to-end type inference without codegen.** tRPC's biggest feature — importing a server type and getting fully inferred client calls with no build step — has no Capix equivalent. `capix client` is codegen, and today it only types inputs.
- **Automatic request batching.** No `httpBatchLink` equivalent; each REST call is its own HTTP request.
- **Rich wire serialization (e.g. `superjson`).** tRPC's transformer system lets `Date`, `Map`, `Set`, etc. cross the wire intact. Capix's REST transport is plain JSON — serialize non-JSON values yourself in the resolver or the schema's `.transform()`.
- **Subscriptions as a procedure type.** Capix's event bus is a separate primitive from capabilities, not a third kind of capability alongside query/mutation — see [Subscriptions](#subscriptions) above.

# Concepts

A brief map of every moving part in Capix.

## Capability

The core primitive. A capability is a function with a name, an optional input schema, an optional output schema, a list of guards, and a resolver. It does not know about HTTP, WebSocket, or any transport.

```
capability(inputSchema?, resolver, intent?)
  .guard(guard)
  .enhance(enhancer)
  .output(outputSchema)
```

Capabilities live in plain objects called **groups**:

```ts
const users = { getUser, listUsers, createUser };
```

Groups nest to form a **group tree**:

```ts
const capabilities = {
  users: { getUser, listUsers, createUser },
  posts: { getPost, listPosts },
};
```

The dot-path (`users.getUser`) uniquely identifies a capability in the tree.

## Context

Context is built once per request from the raw request headers. It is passed to every guard and resolver. It is typed — your application defines the context type.

```ts
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user:      await verifyToken(req.headers.authorization),
  db,
}));
```

## Guards

Guards are preconditions that run before the resolver. They receive the context and throw to reject. Multiple guards run in order; the first failure stops execution.

```ts
const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});
```

## Errors

Typed error factories that produce structured HTTP responses. Define them once, use them anywhere in guards and resolvers.

```ts
const NotFound = defineError(404, 'Not found');
throw NotFound({ detail: 'User id 123 not found' });
// → HTTP 404 { "error": "NotFound", "message": "Not found", "meta": { "detail": "..." } }
```

## Enhancers

Enhancers wrap the resolver for cross-cutting concerns like caching, rate limiting, retries, and circuit breaking. They are applied with `.enhance()` and compose like middleware.

## Plugins

Plugins bundle capabilities and context extensions into a reusable package. They are composed at server creation time.

## Transport

A transport is anything that takes an incoming connection and routes it to the execution engine. Capix ships with REST, WebSocket, GraphQL, Queue, and MCP transports. You can write custom transports.

## Execution engine

The execution engine is the core dispatcher. Given an `(invoke)` function and a compiled registry, it:

1. Looks up the capability by dot-path
2. Calls `buildContext`
3. Runs guards
4. Validates input (if there is a schema)
5. Calls the resolver
6. Returns a structured response

Every transport uses the same execution engine. This is why capabilities behave identically regardless of transport.

## Registry

A compiled, flat map from dot-path to capability. Built by `compileRegistry(groupTree)`. The REST transport uses it to generate routes; the execution engine uses it to look up capabilities.

## Server

`createServer(config)` wires everything together. It:

1. Merges plugins
2. Compiles the capability registry
3. Creates the execution engine
4. Mounts each transport

`server.start()` / `server.stop()` manage transport lifecycle.

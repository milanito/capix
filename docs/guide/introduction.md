# Introduction

Capix is a Node.js server framework built around a single primitive: the **capability**.

A capability is a typed, composable function that declares exactly what your server can do. It has a clear input type, a clear output type, a set of preconditions (guards), and a resolver. Every request — whether it arrives over HTTP, WebSocket, GraphQL, or a job queue — is routed to a capability and executed through the same engine.

## The problem with routes

In a traditional Express application, the server is a flat list of route handlers:

```ts
app.get('/users/:id', authMiddleware, async (req, res) => {
  const user = await db.users.find(req.params.id);
  res.json(user);
});
```

This seems simple. In practice, it creates several recurring problems:

**Silent async errors.** If `db.users.find` throws, Express does not catch it. The server hangs and the client times out. Every handler needs its own try/catch or a wrapper.

**Implicit middleware order.** Whether a request is authenticated depends on whether you remembered to add `authMiddleware` to this particular route. The business logic and the access control are in different places, and it's not obvious from looking at the handler alone.

**Type safety stops at the controller.** TypeScript knows `req.params` is `Record<string, string>`. It does not know `id` is present. You cast — or you add runtime validation and do that separately.

**Testing requires a server.** To test `GET /users/:id`, you either spin up an Express server and make an HTTP call, or you write a unit test that manually assembles `req` and `res` mock objects.

## The capability model

Capix addresses all of these with one design decision: replace route handlers with capabilities.

```ts
// Express — this bug is silent and common
app.get('/user/:id', async (req, res) => {
  const user = await db.find(req.params.id); // throws
  res.json(user);                            // never reached
});

// Capix — this bug cannot happen
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.find(id); // throws → caught, returns 500
    return user;                    // returning is responding
  },
  'query',
);
```

In Capix:

- **All async errors are caught.** The execution engine wraps every resolver. An unhandled throw becomes a structured 500 response.
- **Guards are explicit and typed.** Access control is declared on the capability itself — it cannot be accidentally omitted when the capability is added to a new transport.
- **Input is validated and typed.** The resolver receives a typed object, not `req.params`. TypeScript knows the shape.
- **Testing requires no server.** Call `cap.resolve(input, ctx)` directly. No HTTP. No mocks.

## What Capix is

- A **capability registry** that maps dot-paths like `users.getUser` to typed resolver functions
- A **transport layer** that routes incoming requests to capabilities (REST, WebSocket, GraphQL, queue)
- A **plugin system** for sharing capabilities and context extensions across projects
- An **execution engine** that runs guards, validates input, calls the resolver, and serializes the response

## What Capix is not

- A database ORM or query builder
- An HTTP framework with raw request/response access (use the REST transport's `onRequest` hook for that)
- A replacement for your auth library — Capix provides JWT helpers, but you can use any auth system via `defineContext`
- An opinionated project structure — Capix is a set of composable functions, not a convention enforcer

## The key insight

**HTTP is a transport, not the domain.** Your capability `users.getUser` has no HTTP concept in its definition. It returns a user object. Whether that object is delivered as a JSON response to a REST client, a GraphQL query result, a WebSocket response frame, or the output of a background job — that is the transport's concern, not the capability's.

This is why adding a new transport to a Capix server is a one-line change. The capabilities do not know or care what transport they are running on.

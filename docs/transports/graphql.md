# GraphQL transport

The GraphQL transport generates a spec-compliant GraphQL schema from your capability registry and serves a GraphQL endpoint. An optional GraphiQL playground is available at `{path}/playground`.

See the [package README](../../packages/transports/graphql/README.md) for the full API.

## Schema mapping

| Capix | GraphQL |
|---|---|
| `intent: 'query'` | `Query` field |
| All other intents | `Mutation` field |
| `users.getUser` | `users_getUser` field |
| `z.string()` input | `String!` argument |
| `z.number()` input | `Float!` argument |
| `z.boolean()` input | `Boolean!` argument |
| `.output(schema)` | Named output type |
| No `.output()` | `JSON` scalar |
| `z.coerce.number().default(N)` | Optional `Float` argument |
| `z.string().optional()` | Optional `String` argument |

Dot-paths are converted to underscores: `users.getUser` → `users_getUser`.

## Querying

```graphql
# Named output type (capability uses .output())
{ users_getUser(id: "1") { id name email } }

# JSON scalar (no .output() — entire object returned as-is)
{ system_ping }

# Variables work for all argument types
query GetUser($id: String!) {
  users_getUser(id: $id) { id name }
}

# Mutations
mutation CreateUser($name: String!, $email: String!) {
  users_createUser(name: $name, email: $email) { id name }
}
```

**Note:** Capabilities without `.output()` return the `JSON` scalar. Do not use field selection (`{ id name }`) on `JSON` scalars — query the field directly:

```graphql
# Wrong (returns null)
{ system_ping { ok } }

# Correct
{ system_ping }
```

## Auth header forwarding

The GraphQL transport passes all request headers to `buildContext`. Include `Authorization` in the HTTP request:

```
POST /graphql
Authorization: Bearer eyJ...
Content-Type: application/json
```

`buildContext` receives the header and can verify the JWT normally.

## Playground

The GraphiQL playground is served at `{path}/playground` and is enabled by default. Disable it in production:

```ts
graphqlTransport({
  port: 4000,
  playground: process.env.NODE_ENV !== 'production',
})
```

## Limitations

- **No subscriptions**: request/response only. For real-time, use `wsTransport` alongside the GraphQL transport.
- **`z.lazy` → JSON scalar**: recursive schemas cannot be typed statically and fall back to the `JSON` scalar.
- **No file uploads**: use the REST transport for file upload capabilities.
- **No batching**: one operation per request.

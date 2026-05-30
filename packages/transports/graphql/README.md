# capix-transport-graphql

GraphQL transport for [Capix](https://github.com/capix/capix). Serves a spec-compliant GraphQL endpoint and an optional GraphiQL playground from your Capix capability registry.

## Install

```bash
npm install capix capix-transport-graphql zod
```

## Usage

```ts
import { createServer } from 'capix';
import { graphqlTransport } from 'capix-transport-graphql';
import { buildContext, capabilities } from './capabilities.js';

createServer({
  context: buildContext,
  capabilities,
  transports: [
    graphqlTransport({ port: 4000 }),
  ],
}).start();
```

GraphQL endpoint: `http://localhost:4000/graphql`  
Playground: `http://localhost:4000/graphql/playground`

## Schema mapping

Capability registries are mapped to a GraphQL schema automatically:

| Capix | GraphQL |
|-------|---------|
| `intent: 'query'` | `Query` field |
| All other intents | `Mutation` field |
| `users.getUser` | `users_getUser` field |
| `z.string()` input | `String!` arg |
| `z.number()` input | `Float!` arg |
| `z.boolean()` input | `Boolean!` arg |
| `.output(schema)` | Named output type |
| No `.output()` | `JSON` scalar |
| `z.coerce.number().default(N)` | Optional `Float` arg |

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
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `port` | `number` | — | Port to listen on |
| `host` | `string` | `'0.0.0.0'` | Host to bind to |
| `path` | `string` | `'/graphql'` | GraphQL endpoint path |
| `playground` | `boolean` | `true` | Serve GraphiQL at `{path}/playground` |
| `capabilities` | `GroupTree` | server default | Per-transport capability registry |

## Per-transport capabilities

```ts
createServer({
  context: buildContext,
  transports: [
    graphqlTransport({
      port: 4000,
      capabilities: { users: { list, get } },  // only these capabilities on GraphQL
    }),
  ],
});
```

## License

MIT

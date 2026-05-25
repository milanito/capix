# capix-testing

Test utilities for Capix applications. Provides `mockContext` for unit tests and `testServer` for integration tests — no mocking framework required.

## Install

```bash
npm install --save-dev capix-testing
```

## mockContext

Test capabilities in isolation without a running server:

```ts
import { mockContext } from 'capix-testing';
import { getUser } from '../src/capabilities.js';

test('returns user by id', async () => {
  const ctx = mockContext({ user: { id: '1', admin: false } });
  const result = await getUser.resolve({ id: '1' }, ctx);
  expect(result.name).toBe('Alice');
});

test('guard rejects unauthenticated requests', async () => {
  const ctx = mockContext({ user: null });
  await expect(getUser.resolve({ id: '1' }, ctx)).rejects.toThrow();
});
```

`mockContext(overrides?)` returns a minimal context object. Pass any fields your guards and resolvers read.

## testServer

Spin up a real HTTP server on a random port for integration tests:

```ts
import { testServer } from 'capix-testing';
import { getUser, createUser } from '../src/capabilities.js';

let server: Awaited<ReturnType<typeof testServer>>;

beforeAll(async () => {
  server = await testServer({
    capabilities: { users: { getUser, createUser } },
  });
});

afterAll(() => server.stop());

test('GET /users/:id', async () => {
  const res = await fetch(`${server.url}/users/1`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.data.id).toBe('1');
});
```

`testServer` starts a `capix-transport-rest` server. `server.url` is the base URL (e.g., `http://127.0.0.1:54321`).

## Options

```ts
testServer({
  capabilities: { ... },   // required
  context: buildContext,   // optional custom context builder
  plugins: [...],          // optional plugins
})
```

## License

MIT

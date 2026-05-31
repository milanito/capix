# Testing

Capabilities are pure functions. They can be tested without a server, without HTTP, and without mocking the framework.

## Unit testing capabilities

Call `.resolve(input, ctx)` directly:

```ts
import { describe, it, expect } from 'vitest';
import { getUser } from '../src/capabilities/users/get.js';

describe('getUser', () => {
  it('returns user when found', async () => {
    const ctx = {
      requestId: 'test-id',
      user: { id: '1', role: 'admin' },
      db: {
        users: {
          findById: async (id: string) => ({ id, name: 'Alice', email: 'alice@example.com' }),
        },
      },
    };

    const result = await getUser.resolve({ id: '1' }, ctx);
    expect(result.name).toBe('Alice');
  });

  it('throws 404 when user not found', async () => {
    const ctx = {
      requestId: 'test-id',
      user: { id: '1', role: 'admin' },
      db: { users: { findById: async () => null } },
    };

    await expect(getUser.resolve({ id: 'unknown' }, ctx)).rejects.toMatchObject({
      status: 404,
      error: 'NotFound',
    });
  });
});
```

Guards run in `.resolve()`. If a guard would reject, it rejects. Pass a context that satisfies all guards.

## Testing guards

```ts
import { mustBeAdmin } from '../src/guards.js';

it('mustBeAdmin throws 403 for non-admin user', async () => {
  const ctx = { requestId: 'x', user: { id: '1', role: 'user' } };
  await expect(mustBeAdmin.fn(ctx)).rejects.toMatchObject({ status: 403 });
});
```

Guards are plain functions. Call them directly.

## Integration testing with `@capixjs/testing`

`@capixjs/testing` runs the full execution engine — guards, validation, resolver, output schema — without an HTTP server:

```bash
npm install -D @capixjs/testing
```

```ts
import { testServer } from '@capixjs/testing';

const server = testServer({
  context: buildContext,
  capabilities: { users: { getUser, createUser } },
});

it('creates and retrieves a user', async () => {
  const create = await server.call({
    capability: 'users.createUser',
    input: { name: 'Bob', email: 'bob@example.com' },
    headers: { authorization: 'Bearer admin-token' },
  });

  expect(create.ok).toBe(true);
  expect(create.status).toBe(200);
  expect(create.data).toMatchObject({ name: 'Bob' });

  const get = await server.call({
    capability: 'users.getUser',
    input: { id: create.data.id },
    headers: { authorization: 'Bearer admin-token' },
  });

  expect(get.ok).toBe(true);
  expect(get.data.email).toBe('bob@example.com');
});

it('returns 401 for unauthenticated requests', async () => {
  const res = await server.call({
    capability: 'users.getUser',
    input: { id: '1' },
  });
  expect(res.ok).toBe(false);
  expect(res.status).toBe(401);
});
```

## Mocking context

`mockContext` from `@capixjs/testing` creates a context object with defaults:

```ts
import { mockContext } from '@capixjs/testing';

const ctx = mockContext({
  user: { id: '1', role: 'admin' },
  db: mockDb,
});
// ctx.requestId is auto-generated
```

## Testing errors

Test that errors carry the right code and status:

```ts
it('returns the correct error structure', async () => {
  const res = await server.call({
    capability: 'users.getUser',
    input: { id: 'nonexistent' },
    headers: { authorization: 'Bearer token' },
  });

  expect(res.ok).toBe(false);
  expect(res.status).toBe(404);
  expect(res.error).toBe('NotFound');
  expect(res.message).toBe('Not found');
});
```

## Testing with vitest

Capix recommends [vitest](https://vitest.dev) for its native TypeScript support and ESM compatibility. The scaffolded project includes a `vitest.config.ts`.

```bash
pnpm test          # run all tests
pnpm test --watch  # watch mode
```

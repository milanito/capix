# Errors

Capix errors are typed values, not thrown `Error` objects. They carry a status code, a machine-readable code, and a human-readable message. The execution engine catches them and serializes them as structured HTTP responses.

## Defining errors

```ts
import { defineError } from 'capix';

const errors = {
  NotFound:     defineError(404, 'Not found'),
  Conflict:     defineError(409, 'Conflict'),
  OutOfStock:   defineError(409, 'Out of stock'),
  // Explicit code overrides the message-derived code:
  NotPurchased: defineError(403, 'You can only review products you have purchased', 'NotPurchased'),
};
```

`defineError(status, message, code?)` returns a factory. Call the factory to produce a throwable error:

```ts
throw errors.NotFound();
throw errors.NotFound({ detail: 'User id 123 not found' });
throw errors.OutOfStock({ productId: '123', requested: 5, available: 2 });
```

## Error codes

The error code is derived from the message by default:

- Natural language: `'Not found'` → `'NotFound'`, `'Out of stock'` → `'OutOfStock'`
- Already PascalCase (no spaces, starts uppercase): returned as-is — `'QuotaExceeded'` → `'QuotaExceeded'`

Pass a third argument for full control:

```ts
// Long message, short predictable code
defineError(403, 'You can only review products you have purchased', 'NotPurchased')
// → { error: 'NotPurchased', message: 'You can only review products you have purchased' }
```

## What clients receive

On error, the response body is:

```json
{
  "error": "NotFound",
  "message": "Not found"
}
```

With metadata:

```json
{
  "error": "OutOfStock",
  "message": "Out of stock",
  "meta": { "productId": "123", "requested": 5, "available": 2 }
}
```

The HTTP status code is set from `defineError`'s first argument.

## Built-in errors

```ts
import { defaultErrors } from 'capix';

throw defaultErrors.BadRequest();           // 400
throw defaultErrors.Unauthorized();         // 401
throw defaultErrors.Forbidden();            // 403
throw defaultErrors.NotFound();             // 404
throw defaultErrors.Conflict();             // 409
throw defaultErrors.TooManyRequests();      // 429
throw defaultErrors.Internal();             // 500
throw defaultErrors.Timeout({ capability: 'users.getUser', ms: 5000 }); // 504
```

## Testing errors

Use `isFrameworkError` to check errors in tests:

```ts
import { isFrameworkError } from 'capix';

test('returns 404 when user not found', async () => {
  try {
    await getUser.resolve({ id: 'nonexistent' }, ctx);
    expect.fail('Should have thrown');
  } catch (err) {
    expect(isFrameworkError(err)).toBe(true);
    expect(err.status).toBe(404);
    expect(err.error).toBe('NotFound');
  }
});
```

Or with `capix-testing`:

```ts
const response = await server.call({ capability: 'users.getUser', input: { id: '999' } });
expect(response.ok).toBe(false);
expect(response.status).toBe(404);
```

## Errors are values, not exceptions

Internally, framework errors are plain objects with a brand symbol. They are recognized by the execution engine and serialized — they do not produce stack traces in the response and do not trigger error-level logging by default.

Thrown JavaScript `Error` objects (or non-FrameworkError throws) are caught by the execution engine and returned as `500 Internal Server Error`. The exception is logged with the stack trace.

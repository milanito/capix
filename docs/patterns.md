# Capix Patterns

Common patterns for real-world Capix applications.

---

## Multi-step mutation safety

Capix capabilities are pure functions — they have no built-in transaction support.
For operations that require multiple steps to succeed atomically (like checkout),
combine the **read-check-act** pattern with the `withRollback` enhancer:

1. **Read** all data needed for validation
2. **Check** all business rules (stock, ownership, status)
3. **Act** — register a `ctx.onRollback()` compensation at each step

```ts
import { withRollback } from 'capix';

export const checkout = authCap(z.object({}), async (_, ctx) => {
  // 1. Read
  const cart     = ctx.db.carts.getByCustomer(ctx.user.id);
  const products = cart.items.map((i) => ctx.db.products.get(i.productId));

  // 2. Check everything before changing anything
  if (cart.items.length === 0)         throw errors.BadRequest({ reason: 'Cart is empty' });
  for (const [i, item] of cart.items.entries()) {
    const product = products[i]!;
    if (product.status !== 'active')   throw errors.BadRequest({ reason: 'Product unavailable' });
    if (product.stock < item.quantity) throw errors.OutOfStock({ productId: product.id });
  }

  // 3. Act — register a rollback at each step so failures undo prior work
  const order = ctx.db.orders.create({ customerId: ctx.user.id, items: cart.items });
  ctx.onRollback(() => ctx.db.orders.delete(order.id));

  for (const item of cart.items) {
    ctx.db.products.decrementStock(item.productId, item.quantity);
    ctx.onRollback(() => ctx.db.products.incrementStock(item.productId, item.quantity));
  }

  ctx.db.carts.clear(ctx.user.id);
  ctx.onRollback(() => ctx.db.carts.restore(ctx.user.id, cart));

  ctx.jobs.enqueue({ type: 'send_order_confirmation', orderId: order.id });
  // No rollback for jobs — they're idempotent

  return order;
}, 'mutation').guard(mustBeCustomer).enhance(withRollback);
```

`withRollback` runs compensations in reverse order if the resolver throws.
This is **not** a database transaction — it does not provide atomicity,
isolation, or durability. Use it for in-memory stores or operations where each
step can be independently undone. For a real database, use its transaction API.

---

## Dual-behavior capabilities

When the same endpoint should behave differently based on the caller's role
(e.g. customers see their own orders, staff see all orders), use **in-resolver
branching** rather than two separate capabilities:

```ts
export const listOrders = authCap(
  z.object({
    page:       z.coerce.number().default(1),
    customerId: z.string().optional(), // staff-only filter
  }),
  async ({ page, customerId }, ctx) => {
    const isStaff = ctx.user.role === 'staff' || ctx.user.role === 'admin';
    const filter  = isStaff
      ? (customerId ? { customerId } : {})  // staff can filter by customer
      : { customerId: ctx.user.id };        // customers only see their own

    return ctx.db.orders.findMany({ ...filter, page });
  },
  'query',
).guard(mustBeCustomer);
```

One capability, one route. The alternative (two capabilities with different names)
fragments the API surface and creates confusing route names.

---

## Resource ownership with `inputGuard`

Guards are attached at definition time and only receive context — the request
input is not available. Use `.inputGuard()` for checks that depend on the
resource being requested:

```ts
import { defineInputGuard } from 'capix';

const mustOwnOrder = defineInputGuard(
  async ({ id }: { id: string }, ctx: AuthContext) => {
    const order = ctx.db.orders.get(id);
    if (!order)                         throw errors.NotFound({ resource: 'order', id });
    if (order.customerId !== ctx.user.id) throw errors.Forbidden();
  },
);

export const cancelOrder = authCap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => {
    // Ownership already verified — no repeat check needed
    const order = ctx.db.orders.get(id)!;
    if (order.status === 'shipped') throw errors.OrderNotCancellable();
    return ctx.db.orders.update(id, { status: 'cancelled' });
  },
  'mutation',
)
  .guard(mustBeCustomer)
  .inputGuard(mustOwnOrder);
```

Input guards run after input validation (so they receive typed, transformed data)
and before the resolver.

---

## HMAC webhook verification

Webhook providers (Stripe, GitHub, Shopify) sign the raw request bytes. Capix
parses JSON before the resolver runs, but the original bytes are available via
`ctx.rawBody` if you include them in your context builder:

```ts
// src/context.ts
export type Context = {
  requestId: string;
  user:      Customer | null;
  rawBody:   Buffer | undefined; // populated for POST/PATCH with a body
};

export const buildContext = defineContext(async (req): Promise<Context> => ({
  requestId: crypto.randomUUID(),
  user:      await resolveUser(req),
  rawBody:   req.rawBody, // forwarded from the REST transport
}));
```

```ts
// src/capabilities/payments/webhook.ts
import * as crypto from 'node:crypto';

const mustBeValidStripeSignature = defineGuard((ctx: Context) => {
  const sig  = getHeader(ctx._req, 'stripe-signature'); // or however you store it
  const body = ctx.rawBody;
  if (!body || !sig) throw errors.Unauthorized();

  const expected = crypto
    .createHmac('sha256', process.env['STRIPE_WEBHOOK_SECRET']!)
    .update(body)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw errors.Unauthorized();
  }
});

export const stripeWebhook = cap(
  StripeEventSchema,
  async (event, ctx) => {
    // HMAC verified by guard, body already parsed by Capix
    switch (event.type) {
      case 'payment_intent.succeeded': await ctx.db.orders.markPaid(event.data.object.metadata.orderId);
    }
    return { received: true };
  },
  'mutation',
).guard(mustBeValidStripeSignature);
```

Register the override in `restTransport`:
```ts
createServer({
  context: buildContext,
  capabilities,
  transports: [restTransport({
    port: 3000,
    overrides: {
      'payments.stripeWebhook': { method: 'POST', path: '/webhooks/stripe' },
    },
  })],
}).start();
```

The key insight: include `rawBody: req.rawBody` in your context in `buildContext`.
The framework exposes raw bytes; your app decides what to do with them.

---

## `exactOptionalPropertyTypes` and partial updates

The scaffold tsconfig enables `exactOptionalPropertyTypes: true`. Zod partial
schemas produce `{ field?: T | undefined }`, but database update methods often
expect `{ field?: T }` (no `undefined` in the union). The mismatch causes a
TypeScript error.

**Workaround — strip undefined before passing to DB:**

```ts
export const updateProduct = authCap(
  z.object({
    id:    z.string(),
    name:  z.string().min(1).optional(),
    price: z.number().positive().optional(),
  }),
  async ({ id, ...data }, ctx) => {
    const patch = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined),
    ) as Partial<Product>;

    return ctx.db.products.update(id, patch);
  },
  'update',
).guard(mustBeAdmin);
```

**Or use a reusable utility:**

```ts
function definedFields<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as never;
}

// In resolver:
return ctx.db.products.update(id, definedFields(data));
```

---

## Background jobs (fire-and-forget)

Capix has no native job queue. The simplest pattern is a module-level typed
job queue that the resolver enqueues to:

```ts
// src/jobs.ts
export type Job =
  | { type: 'send_order_confirmation'; orderId: string }
  | { type: 'send_welcome_email';      userId: string }
  | { type: 'reindex_product';         productId: string };

export const jobQueue = {
  enqueue(job: Job): void {
    setImmediate(() => processJob(job));
  },
};

async function processJob(job: Job): Promise<void> {
  switch (job.type) {
    case 'send_order_confirmation': await sendOrderEmail(job.orderId); break;
    case 'send_welcome_email':      await sendWelcomeEmail(job.userId); break;
    case 'reindex_product':         await reindexProduct(job.productId); break;
  }
}
```

```ts
// In resolver:
ctx.jobs.enqueue({ type: 'send_order_confirmation', orderId: order.id });
return order; // returns immediately — job runs in background
```

For production, replace `setImmediate` with a real queue (BullMQ, Faktory, etc.)
without changing the capability code — just swap the `enqueue` implementation.

---

## Enhancers that require guards

**KNOWN LIMITATION:** TypeScript cannot enforce that a specific guard was applied
before an enhancer. If your enhancer accesses context fields that are only non-null
after a guard runs (e.g. `ctx.org`, `ctx.user`), the compiler accepts the enhancer
applied to any capability — a missing guard fails silently at runtime.

**Recommended mitigations:**

1. **Fail fast in the enhancer** — check the field and throw an internal error
   rather than letting a null dereference produce an opaque crash:

```ts
export const withUsageTracking = (resource: string) =>
  defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      const appCtx = ctx as AppContext;

      if (!appCtx.org) {
        // Guards were not applied in the right order.
        throw new Error(`[withUsageTracking] ctx.org is null — apply mustBeAuthenticated before withUsageTracking`);
      }

      const limit = planLimit(appCtx.org.plan, resource);
      const current = appCtx.db.usage.get(appCtx.org.id, currentPeriod(), resource);
      if (current >= limit) throw errors.QuotaExceeded({ resource, limit, current });

      const result = await (cap as AnyCapability).resolve(input, ctx);
      appCtx.db.usage.increment(appCtx.org.id, currentPeriod(), resource);
      return result;
    },
  })) as ReturnType<typeof defineEnhancer>;
```

2. **Document the dependency** — add a JSDoc comment to the enhancer factory:

```ts
/**
 * Checks and increments quota for the given resource.
 *
 * KNOWN LIMITATION: TypeScript does not enforce ordering — the compiler will not
 * warn if this enhancer is applied without a prior `mustBeAuthenticated` guard.
 * `ctx.org` will be null at runtime if the guard is missing.
 *
 * Always apply guards before this enhancer:
 * ```ts
 * cap(schema, resolver, 'mutation')
 *   .guard(mustBeAuthenticated)
 *   .enhance(withUsageTracking('projects'));  // ← ctx.org is now guaranteed non-null
 * ```
 */
export const withUsageTracking = (resource: string) => defineEnhancer(/* ... */);
```

3. **Use a typed factory pattern** — pass the narrowed context type as a type
   parameter and cast at call sites:

```ts
function withUsageTracking<TCtx extends { org: Org; db: DB }>(resource: string) {
  return defineEnhancer((cap) => ({
    ...cap,
    resolve: async (input: unknown, ctx: unknown) => {
      const appCtx = ctx as TCtx;
      // ctx.org is typed non-null here — the assertion is still runtime-only
      // but the type parameter communicates the requirement
    },
  })) as ReturnType<typeof defineEnhancer>;
}
```

This documents intent but still doesn't prevent misuse at compile time.

---

## Cursor pagination

Capix has no pagination primitives. Implement cursor pagination entirely in the
resolver — the framework stays out of the way:

```ts
type Cursor = { id: string; createdAt: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(s: string): Cursor {
  return JSON.parse(Buffer.from(s, 'base64url').toString()) as Cursor;
}

export const listOrders = authCap(
  z.object({
    limit:  z.coerce.number().min(1).max(100).default(20),
    cursor: z.string().optional(),
    status: z.enum(['pending', 'paid', 'shipped']).optional(),
  }),
  async ({ limit, cursor, status }, ctx) => {
    const after = cursor ? decodeCursor(cursor) : undefined;
    const items = await ctx.db.orders.findMany({
      customerId: ctx.user.id,
      status,
      after,
      limit: limit + 1, // fetch one extra to detect next page
    });

    const hasMore = items.length > limit;
    const page    = items.slice(0, limit);
    const last    = page[page.length - 1];
    const nextCursor = hasMore && last
      ? encodeCursor({ id: last.id, createdAt: last.createdAt })
      : null;

    return { items: page, nextCursor };
  },
  'query',
).guard(mustBeCustomer);
```

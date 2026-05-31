# Multi-step mutations

For operations that require multiple steps to succeed atomically — like checkout, a transfer, or an onboarding flow — use the **read-check-act** pattern with `withRollback`.

## The pattern

1. **Read** all data needed for validation upfront
2. **Check** all business rules before making any changes
3. **Act** — register a `ctx.onRollback()` compensation before each change

```ts
import { z } from 'zod';
import { withRollback } from '@capixjs/core';
import { authCap } from '../../capabilities.js';
import { mustBeCustomer } from '../../guards.js';

export const checkout = authCap(z.object({}), async (_, ctx) => {
  // 1. Read
  const cart     = await ctx.db.carts.getByCustomer(ctx.user.id);
  const products = await Promise.all(cart.items.map((i) => ctx.db.products.get(i.productId)));

  // 2. Check everything before changing anything
  if (cart.items.length === 0) throw errors.BadRequest({ reason: 'Cart is empty' });
  for (const [i, item] of cart.items.entries()) {
    const product = products[i]!;
    if (product.status !== 'active')   throw errors.BadRequest({ reason: 'Product unavailable' });
    if (product.stock < item.quantity) throw errors.OutOfStock({ productId: product.id });
  }

  // 3. Act — register rollback before each side effect
  const order = await ctx.db.orders.create({ customerId: ctx.user.id, items: cart.items });
  ctx.onRollback(() => ctx.db.orders.delete(order.id));

  for (const item of cart.items) {
    await ctx.db.products.decrementStock(item.productId, item.quantity);
    ctx.onRollback(() => ctx.db.products.incrementStock(item.productId, item.quantity));
  }

  await ctx.db.carts.clear(ctx.user.id);
  ctx.onRollback(() => ctx.db.carts.restore(ctx.user.id, cart));

  await ctx.jobs.enqueue({ type: 'send_order_confirmation', orderId: order.id });
  // No rollback for the job — job processing is idempotent

  return order;
}, 'mutation').guard(mustBeCustomer).enhance(withRollback);
```

If any step throws after the order is created, `withRollback` runs the compensations in reverse order:
- Restore the cart
- Restore inventory for each item
- Delete the order

## What `withRollback` is not

`withRollback` is **not** a database transaction. It does not provide:

- **Atomicity**: other requests can observe intermediate state between steps
- **Isolation**: concurrent requests can conflict
- **Durability**: rollbacks are in-memory; a crash between steps leaves partial state

**When to use it:**
- In-memory stores where each step is independently reversible
- External APIs where you can issue compensating calls (create → delete, increment → decrement)
- Development or testing environments

**When to use a real transaction instead:**
- Any relational database — use `db.transaction(async (trx) => { ... })`
- Operations where partial state is unacceptable

## Partial failure handling

If a rollback itself fails, `withRollback` logs the error and continues with the remaining rollbacks. It does not re-throw from the rollback — the original error is always what propagates to the caller.

## Sequence matters

Register rollbacks immediately before the operation they compensate:

```ts
// ✓ Correct — rollback registered right before the side effect
const order = await db.orders.create(...);
ctx.onRollback(() => db.orders.delete(order.id));
const charge = await stripe.charges.create(...);
ctx.onRollback(() => stripe.charges.refund(charge.id));

// ✗ Wrong — if stripe.create throws, the order rollback still runs (this is fine)
//   but if you registered all rollbacks upfront, you might rollback operations
//   that never happened
```

Rollbacks run in reverse registration order, which naturally undoes steps in reverse sequence.

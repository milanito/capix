# Privacy patterns

Guard ordering affects what information leaks to callers. A poorly ordered guard chain can reveal whether a resource exists to users who are not authorized to see it.

## The problem: existence leaks

```ts
// ✗ Insecure — reveals whether the resource exists to unauthenticated callers
const getPrivateProfile = cap(
  z.object({ username: z.string() }),
  async ({ username }, ctx) => {
    const user = await ctx.db.users.findByUsername(username);
    if (!user) throw errors.NotFound(); // reveals that user does not exist
    if (!ctx.user) throw errors.Unauthorized(); // only reached if user exists
    return user;
  },
  'query',
);
```

An unauthenticated caller can probe usernames: `NotFound` → username available, `Unauthorized` → username taken.

## The fix: check auth before existence

```ts
// ✓ Secure — auth failure is indistinguishable from not-found to unauthenticated callers
const getPrivateProfile = cap(
  z.object({ username: z.string() }),
  async ({ username }, ctx) => {
    if (!ctx.user) throw errors.Unauthorized(); // auth check first
    const user = await ctx.db.users.findByUsername(username);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
).guard(mustBeUser);
```

Or even better — return `NotFound` for both cases to make the two paths truly indistinguishable:

```ts
const getPrivateProfile = cap(
  z.object({ username: z.string() }),
  async ({ username }, ctx) => {
    if (!ctx.user) throw errors.NotFound(); // auth failure looks like not-found
    const user = await ctx.db.users.findByUsername(username);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
);
```

## Guard ordering for multi-step checks

Declare guards from coarsest to finest:

```ts
// ✓ Correct order
const getPost = cap(schema, handler)
  .guard(mustBeUser)           // 1. logged in?
  .guard(mustNotBeBlocked)     // 2. not blocked by author?
  .guard(mustBeVisibleToUser); // 3. visible to this user?
```

If `mustNotBeBlocked` ran first, an anonymous caller could detect whether they are blocked (a privacy leak — it reveals a relationship). Check authentication first.

## Hiding timing

Response time can also leak information. If an existence check takes measurably longer than an auth check, callers can infer resource existence from response latency.

Mitigations:

```ts
// Approach 1: skip DB entirely for unauthenticated callers
const getPrivateProfile = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => {
    if (!ctx.user) throw errors.NotFound(); // no DB call — same timing as not-found
    const user = await ctx.db.users.find(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
);
```

```ts
// Approach 2: for high-security paths, use a guard that always takes constant time
const mustBeUserOrNotFound = defineGuard(async (ctx) => {
  if (!ctx.user) {
    // Add artificial delay to match the typical DB lookup time
    await new Promise((resolve) => setTimeout(resolve, 10));
    throw errors.NotFound();
  }
});
```

Timing attacks are rarely a concern for typical business APIs but are important for auth flows, payment APIs, and privacy-sensitive profiles.

## Principle of least information

Return only what the caller needs. Use `.output()` schemas to strip fields:

```ts
const AdminUserSchema = z.object({ id: true, email: true, role: true, createdAt: true });
const PublicUserSchema = z.object({ id: true, name: true, avatarUrl: true });

// Admins see everything
const getUserAdmin = cap(
  z.object({ id: z.string() }),
  async ({ id }, ctx) => ctx.db.users.find(id),
  'query',
).guard(mustBeAdmin).output(AdminUserSchema);

// Public endpoint — only public fields
const getUserPublic = cap(
  z.object({ id: z.string() }),
  async ({ id }) => ctx.db.users.find(id),
  'query',
).output(PublicUserSchema);
```

The output schema strips fields at the framework level — callers never see `passwordHash`, `internalFlags`, or other private fields even if the resolver accidentally returns them.

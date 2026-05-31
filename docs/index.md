---
layout: home

hero:
  name: "Capix"
  text: "Capabilities, not routes."
  tagline: "Write what your server can do. The framework handles how it's exposed."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/quick-start
    - theme: alt
      text: View on GitHub
      link: https://github.com/milanito/capix

features:
  - icon: 🎯
    title: One primitive
    details: Capability — a typed, validated, guardable function. REST, GraphQL, WebSocket, and queue all invoke the same thing.

  - icon: 🔒
    title: Errors are caught
    details: Throw anything, get a structured HTTP response. No more silent async failures or forgotten try/catch.

  - icon: ⚡
    title: Fast
    details: 28,000 req/s on hello world. Beats Express by 65%, Hono by 19–27%. Within 3% of Fastify on auth+guard.

  - icon: 🧰
    title: Complete CLI
    details: "capix new, generate, dev, list, show, call, check, docs, client — everything you need to build and maintain an API."
---

## The problem with Express

```js
// This bug is silent, common, and hard to debug
app.get('/user/:id', async (req, res) => {
  const user = await db.find(req.params.id); // throws if db is down
  res.json(user);                            // never reached — client hangs
});
```

## The Capix way

```ts
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.find(id); // throws → client gets a clean 500
    if (!user) throw errors.NotFound({ resource: 'user', id }); // → 404
    return user; // returning is responding
  },
  'query',
).guard(mustBeUser); // guards run before the resolver, every time
```

[Get started in 5 minutes →](/guide/quick-start)

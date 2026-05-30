# Migrating from Express

Side-by-side translations of common Express patterns to Capix.

## Route handler

```ts
// Express
app.get('/users/:id', async (req, res) => {
  const user = await db.users.find(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

// Capix
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => {
    const user = await db.users.find(id);
    if (!user) throw errors.NotFound();
    return user;
  },
  'query',
);
// Route inferred: GET /users/:id
```

## Auth middleware

```ts
// Express
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  req.user = verifyToken(token);
  next();
};

app.get('/profile', authMiddleware, async (req, res) => { ... });

// Capix
const buildContext = defineContext(async (req) => ({
  requestId: crypto.randomUUID(),
  user: await verifyToken(req.headers.authorization),
}));

const mustBeUser = defineGuard((ctx) => {
  if (!ctx.user) throw errors.Unauthorized();
});

const getProfile = cap(z.object({}), async (_, ctx) => ctx.user, 'query')
  .guard(mustBeUser);
```

## Request body

```ts
// Express
app.post('/users', express.json(), async (req, res) => {
  const { name, email } = req.body;
  const user = await db.users.create({ name, email });
  res.json(user);
});

// Capix
const createUser = capability(
  z.object({ name: z.string(), email: z.string().email() }),
  async ({ name, email }) => db.users.create({ name, email }),
);
// Route inferred: POST /users
```

## Error handling

```ts
// Express — requires explicit try/catch or error middleware
app.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db.users.find(req.params.id);
    res.json(user);
  } catch (err) {
    next(err); // without this, the server hangs
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: err.message });
});

// Capix — all errors caught automatically
const getUser = capability(
  z.object({ id: z.string() }),
  async ({ id }) => db.users.find(id), // throws → 500, automatically
  'query',
);
```

## Router / grouping

```ts
// Express
const usersRouter = express.Router();
usersRouter.get('/',    listUsers);
usersRouter.get('/:id', getUser);
usersRouter.post('/',   createUser);
app.use('/users', usersRouter);

// Capix
const capabilities = {
  users: { listUsers, getUser, createUser },
};
// Routes inferred from names + group key
```

## Query string params

```ts
// Express
app.get('/items', async (req, res) => {
  const page  = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const items = await db.items.list({ page, limit });
  res.json(items);
});

// Capix — coercion and defaults in the schema
const listItems = capability(
  z.object({
    page:  z.coerce.number().default(1),
    limit: z.coerce.number().max(100).default(20),
  }),
  async ({ page, limit }) => db.items.list({ page, limit }),
  'query',
);
```

## Middleware for cross-cutting concerns

```ts
// Express — middleware runs on every route, order matters
app.use(cors());
app.use(helmet());
app.use(morgan('combined'));

// Capix — plugins compose cleanly
createServer({
  plugins: [
    corsPlugin({ origin: 'https://app.example.com' }),
    helmetPlugin(),
    loggingPlugin({ level: 'info' }),
  ],
  ...
});
```

## File uploads

```ts
// Express + multer
import multer from 'multer';
const upload = multer({ dest: '/tmp' });

app.post('/upload', upload.single('file'), async (req, res) => {
  const { originalname, buffer } = req.file;
  await storage.save(originalname, buffer);
  res.json({ ok: true });
});

// Capix
import type { UploadedFile } from 'capix-transport-rest';

const uploadFile = capability(
  z.object({ file: z.custom<UploadedFile>() }),
  async ({ file }) => {
    await storage.save(file.originalName, file.buffer);
    return { ok: true };
  },
);
```

## Reference table

| Express | Capix |
|---|---|
| `app.get('/users', handler)` | `capability(schema, resolver, 'query')` |
| `app.use(authMiddleware)` | `.guard(mustBeUser)` |
| `req.body`, `req.params`, `req.query` | single validated `input` object |
| `res.json(data)` | `return data` |
| `next(error)` | `throw error` |
| `express.Router()` | group object `{ users: { list, get, create } }` |
| `app.use(cors())` | `plugins: [corsPlugin()]` |
| `app.use((err, req, res, next) => ...)` | not needed — all errors caught automatically |
| `req.user = ...` (via middleware) | `ctx.user = ...` (via `buildContext`) |
| `app.listen(3000)` | `createServer({ transports: [restTransport({ port: 3000 })] }).start()` |

## What Capix cannot replace

- **Raw WebSocket handling**: Capix's WS transport is request/response. For raw streaming protocols (binary frames, custom protocols), use a raw WebSocket library alongside Capix.
- **Server-Sent Events (SSE)**: not currently supported. Use the WS transport for real-time push.
- **HTTP/2 / HTTP/3**: Capix's REST transport uses Node.js `http` (HTTP/1.1). Place Nginx or a CDN in front for HTTP/2 support.
- **Template rendering**: Capix returns JSON. If you need HTML rendering, return HTML strings from a resolver and set a custom Content-Type header via `onRequest`.

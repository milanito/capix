import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/hello', (c) => c.json({ message: 'hello world' }));

app.get('/users/:id', (c) => c.json({ id: c.req.param('id'), name: 'Alice' }));

app.get('/profile', (c) => {
  if (!c.req.header('authorization')?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return c.json({ id: '1' });
});

serve({ fetch: app.fetch, port: 3003 }, () => {
  console.log('Hono listening on http://localhost:3003');
});

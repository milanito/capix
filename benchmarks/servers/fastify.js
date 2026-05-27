import Fastify from 'fastify';

const app = Fastify({ logger: false });

app.get('/hello', async () => ({ message: 'hello world' }));

app.get('/users/:id', async (req) => ({ id: req.params.id, name: 'Alice' }));

app.get('/profile', async (req, reply) => {
  if (!req.headers.authorization?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  return { id: '1' };
});

await app.listen({ port: 3002 });
console.log('Fastify listening on http://localhost:3002');

import { createServer, defineContext } from 'capix';
import { restTransport } from 'capix-transport-rest';
import { capabilities } from './capabilities.js';

const PORT = Number(process.env['PORT'] ?? 3000);

const buildContext = defineContext(async () => ({ requestId: crypto.randomUUID() }));

const server = createServer({
  context: buildContext,
  capabilities,
  transports: [restTransport({ port: PORT, cors: { origin: '*' } })],
});

server.start().then(() => {
  console.log(`Pagination example listening on http://localhost:${PORT}`);
  console.log();
  console.log('Try it:');
  console.log(`  curl 'http://localhost:${PORT}/products/listProducts'`);
  console.log(`  curl 'http://localhost:${PORT}/products/listProducts?page=2&pageSize=3'`);
  console.log(`  curl 'http://localhost:${PORT}/products/listProducts?category=peripherals&sortBy=priceUsd&sortDir=desc'`);
  console.log(`  curl 'http://localhost:${PORT}/products/listProducts?search=desk&inStock=true'`);
  console.log(`  curl 'http://localhost:${PORT}/products/listProducts?minPrice=50&maxPrice=200'`);
});

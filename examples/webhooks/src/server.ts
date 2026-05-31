/**
 * Webhook receiver with HMAC-SHA256 signature verification.
 *
 * HMAC verification requires the raw body bytes — before JSON parsing.
 * This example uses a custom HTTP server for the webhook endpoint so we
 * can read the raw body, verify the signature, and then call server.invoke().
 * Regular read capabilities go through the REST transport.
 */
import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { createServer, defineContext } from '@capixjs/core';
import { restTransport } from '@capixjs/transport-rest';
import { capabilities } from './capabilities.js';

const WEBHOOK_SECRET = process.env['WEBHOOK_SECRET'] ?? 'dev-webhook-secret';
const PORT = Number(process.env['PORT'] ?? 3000);

const buildContext = defineContext(async () => ({ requestId: crypto.randomUUID() }));

const server = createServer({
  context: buildContext,
  capabilities,
  transports: [restTransport({ port: PORT + 1, cors: { origin: '*' } })],
});

function verifySignature(rawBody: Buffer, signature: string): boolean {
  const expected = `sha256=${crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')}`;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

function readBody(req: http.IncomingMessage, maxBytes = 512 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('PAYLOAD_TOO_LARGE'));
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

const webhookServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/webhook') {
    res.writeHead(404);
    res.end();
    return;
  }

  let rawBody: Buffer;
  try {
    rawBody = await readBody(req);
  } catch {
    jsonResponse(res, 413, { ok: false, error: { status: 413, error: 'PayloadTooLarge', message: 'Body too large' } });
    return;
  }

  const signature = req.headers['x-signature-256'];
  if (typeof signature !== 'string' || !verifySignature(rawBody, signature)) {
    jsonResponse(res, 401, { ok: false, error: { status: 401, error: 'Unauthorized', message: 'Invalid or missing X-Signature-256' } });
    return;
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody.toString());
  } catch {
    jsonResponse(res, 400, { ok: false, error: { status: 400, error: 'BadRequest', message: 'Invalid JSON body' } });
    return;
  }

  const result = await server.invoke({
    capability: 'webhooks.receiveWebhook',
    input,
    headers: {},
    signal: AbortSignal.timeout(10_000),
  });

  jsonResponse(res, result.ok ? 200 : (result.error.status ?? 500), result);
});

server.start().then(() => {
  webhookServer.listen(PORT, () => {
    console.log(`Webhooks example:`);
    console.log(`  Webhook endpoint:  POST http://localhost:${PORT}/webhook`);
    console.log(`  Read API:          http://localhost:${PORT + 1}/webhooks/listWebhookEvents`);
    console.log();

    const payload = JSON.stringify({
      type: 'user.created',
      data: { id: '1', email: 'alice@example.com', name: 'Alice', createdAt: new Date().toISOString() },
    });
    const sig = `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex')}`;

    console.log('Send a signed event:');
    console.log(`  curl -X POST http://localhost:${PORT}/webhook \\`);
    console.log(`    -H 'Content-Type: application/json' \\`);
    console.log(`    -H 'X-Signature-256: ${sig}' \\`);
    console.log(`    -d '${payload}'`);
    console.log();
    console.log('Send without signature (should 401):');
    console.log(`  curl -X POST http://localhost:${PORT}/webhook -H 'Content-Type: application/json' -d '${payload}'`);
  });
});

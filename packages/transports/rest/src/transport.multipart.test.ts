import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import FormData from 'form-data';
import { createServer, capability, defineContext } from '@capixjs/core';
import { z } from 'zod';
import { restTransport, uploadedFile } from './index.js';
import type { Server } from '@capixjs/core';
import type { UploadedFile } from './multipart.js';

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

/**
 * getFreePort() closes its probe socket before the real server binds to that
 * port number — under CI-level parallelism, another test file's probe can
 * claim the same ephemeral port in that gap, so the real bind then fails
 * with EADDRINUSE. Retries with a fresh port on that specific failure.
 */
async function startOnFreePort<T extends { start: () => Promise<void> }>(
  build: (port: number) => T,
  maxAttempts = 5,
): Promise<{ server: T; port: number }> {
  for (let attempt = 1; ; attempt++) {
    const port = await getFreePort();
    const server = build(port);
    try {
      await server.start();
      return { server, port };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'EADDRINUSE' || attempt >= maxAttempts) throw err;
    }
  }
}

const buildContext = defineContext(async () => ({ requestId: crypto.randomUUID() }));

// A capability that accepts a multipart file + a text field
const receiveFile = capability(
  z.object({
    file: uploadedFile({ maxSize: 1024 * 1024 }),
    description: z.string().optional(),
  }),
  ({ file, description }) => ({
    filename: file.filename,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    description: description ?? null,
  }),
);

// A capability that only accepts JSON — used to verify multipart without option returns 415-ish
const jsonOnly = capability(
  z.object({ name: z.string() }),
  ({ name }) => ({ hello: name }),
);

let server: Server;
let port: number;
let portNoMultipart: number;
let serverNoMultipart: Server;

beforeAll(async () => {
  ({ server, port } = await startOnFreePort((p) => createServer({
    context: buildContext,
    capabilities: { files: { receiveFile } },
    transports: [
      restTransport({
        port: p,
        multipart: { maxFileSize: 512, maxFiles: 1 }, // tiny limit for test
      }),
    ],
  })));

  ({ server: serverNoMultipart, port: portNoMultipart } = await startOnFreePort((p) => createServer({
    context: buildContext,
    capabilities: { api: { jsonOnly } },
    transports: [restTransport({ port: p })],
  })));
});

afterAll(async () => {
  await server.stop();
  await serverNoMultipart.stop();
});

describe('multipart transport integration', () => {
  it('parses multipart/form-data and delivers UploadedFile to capability', async () => {
    const form = new FormData();
    form.append('file', Buffer.from('hello world'), { filename: 'hello.txt', contentType: 'text/plain' });
    form.append('description', 'A test file');

    const res = await fetch(`http://localhost:${port}/files/receive-file`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: form.getHeaders(),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { filename: string; contentType: string; sizeBytes: number; description: string } };
    expect(json.data.filename).toBe('hello.txt');
    expect(json.data.contentType).toBe('text/plain');
    expect(json.data.sizeBytes).toBe(11);
    expect(json.data.description).toBe('A test file');
  });

  it('text fields are merged with file fields in capability input', async () => {
    const form = new FormData();
    form.append('file', Buffer.from('data'), { filename: 'data.bin', contentType: 'application/octet-stream' });
    form.append('description', 'merged');

    const res = await fetch(`http://localhost:${port}/files/receive-file`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: form.getHeaders(),
    });

    expect(res.status).toBe(200);
    const json = await res.json() as { data: { description: string } };
    expect(json.data.description).toBe('merged');
  });

  it('oversized file returns 413 before capability runs', async () => {
    const form = new FormData();
    form.append('file', Buffer.alloc(600), { filename: 'big.bin', contentType: 'application/octet-stream' });

    const res = await fetch(`http://localhost:${port}/files/receive-file`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: form.getHeaders(),
    });

    expect(res.status).toBe(413);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('PayloadTooLarge');
  });

  it('uploadedFile schema rejects wrong content type via Zod', async () => {
    const restrictedCapability = capability(
      z.object({
        file: uploadedFile({ accept: ['image/jpeg', 'image/png'] }),
      }),
      ({ file }: { file: UploadedFile }) => ({ filename: file.filename }),
    );

    const { server: srv } = await startOnFreePort((port) => createServer({
      context: buildContext,
      capabilities: { test: { restrictedCapability } },
      transports: [restTransport({ port, multipart: true })],
    }));

    // Use the server's invoke directly to test the Zod schema
    const result = await srv.invoke({
      capability: 'test.restrictedCapability',
      input: {
        file: {
          filename: 'code.ts',
          contentType: 'text/typescript',
          sizeBytes: 100,
          buffer: Buffer.from('code'),
        },
      },
      headers: {},
      signal: AbortSignal.timeout(5000),
    });

    await srv.stop();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(400);
      expect(result.error.meta?.issues).toBeDefined();
    }
  });

  it('multipart without transport option — body is ignored (no multipart parsing)', async () => {
    const form = new FormData();
    form.append('name', 'test');

    const res = await fetch(`http://localhost:${portNoMultipart}/api/json-only`, {
      method: 'POST',
      body: form.getBuffer(),
      headers: form.getHeaders(),
    });

    // Without multipart option, the body is not parsed as form — input is empty {} → Zod fails
    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toBe('BadRequest');
  });
});

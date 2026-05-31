import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as net from 'node:net';
import { capability, createServer, defineContext, defineGuard, defineError } from '@capixjs/core';
import { restTransport, uploadedFile } from '@capixjs/transport-rest';
import type { UploadedFile } from '@capixjs/transport-rest';
import { z } from 'zod';
import type { Server } from '@capixjs/core';

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

// ---------------------------------------------------------------------------
// Types and context
// ---------------------------------------------------------------------------

type Ctx = { requestId: string; user: { id: string } | null };

const TOKENS = new Map([['user-token', { id: 'u1' }]]);

const buildContext = defineContext(async (req): Promise<Ctx> => {
  const auth = req.headers['authorization'];
  const token = typeof auth === 'string' ? auth.replace('Bearer ', '') : null;
  return { requestId: crypto.randomUUID(), user: token ? (TOKENS.get(token) ?? null) : null };
});

const errors = { Unauthorized: defineError(401, 'Unauthorized') };

const mustBeUser = defineGuard((ctx: Ctx): asserts ctx is Ctx & { user: { id: string } } => {
  if (!ctx.user) throw errors.Unauthorized();
});

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

type UploadResult = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  description: string | null;
  content: string;
};

const uploadFile = capability(
  z.object({
    file: uploadedFile({ maxSize: 512 * 1024, accept: ['image/png', 'image/jpeg', 'text/plain'] }),
    description: z.string().max(200).optional(),
  }),
  async ({ file, description }: { file: UploadedFile; description?: string }): Promise<UploadResult> => ({
    filename: file.filename,
    contentType: file.contentType,
    sizeBytes: file.sizeBytes,
    description: description ?? null,
    content: file.buffer.toString('utf8'),
  }),
).guard(mustBeUser);

// capability with no file type restriction
const uploadAny = capability(
  z.object({ file: uploadedFile() }),
  ({ file }: { file: UploadedFile }) => ({ filename: file.filename, sizeBytes: file.sizeBytes }),
);

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const port = await getFreePort();
  baseUrl = `http://localhost:${port}`;
  server = createServer({
    context: buildContext,
    capabilities: {
      uploads: { uploadFile },
      open: { uploadAny },
    },
    transports: [
      restTransport({
        port,
        multipart: { maxFileSize: 512 * 1024, maxFiles: 1 },
      }),
    ],
  });
  await server.start();
});

afterAll(async () => { await server.stop(); });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeForm(file: { name: string; content: string | Buffer; type: string }, fields?: Record<string, string>): FormData {
  const form = new FormData();
  const blob = new Blob([typeof file.content === 'string' ? file.content : file.content], { type: file.type });
  form.append('file', blob, file.name);
  if (fields) {
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
  }
  return form;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('multipart file upload — integration', () => {
  it('authenticated user can upload a text file', async () => {
    const form = makeForm({ name: 'hello.txt', content: 'hello world', type: 'text/plain' });
    // uploadFile → mutation (non-create) → POST /uploads/upload-file
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: UploadResult };
    expect(body.data.filename).toBe('hello.txt');
    expect(body.data.contentType).toBe('text/plain');
    expect(body.data.sizeBytes).toBe(11);
    expect(body.data.content).toBe('hello world');
  });

  it('unauthenticated request returns 401', async () => {
    const form = makeForm({ name: 'hello.txt', content: 'hello', type: 'text/plain' });
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(401);
  });

  it('disallowed file type returns 400 via Zod schema', async () => {
    const form = makeForm({ name: 'script.ts', content: 'const x = 1;', type: 'text/typescript' });
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: form,
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; meta: { issues: unknown[] } };
    expect(body.error).toBe('BadRequest');
    expect(Array.isArray(body.meta.issues)).toBe(true);
  });

  it('text fields are merged — description passed to capability', async () => {
    const form = makeForm(
      { name: 'photo.txt', content: 'fake image', type: 'text/plain' },
      { description: 'my favorite photo' },
    );
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: UploadResult };
    expect(body.data.description).toBe('my favorite photo');
  });

  it('oversized file returns 413 before capability runs', async () => {
    const bigContent = 'x'.repeat(600 * 1024); // 600KB > 512KB limit
    const form = makeForm({ name: 'big.txt', content: bigContent, type: 'text/plain' });
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: form,
    });
    expect(res.status).toBe(413);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('PayloadTooLarge');
  });

  it('capability receives correct file buffer content', async () => {
    const content = 'the quick brown fox';
    const form = makeForm({ name: 'fox.txt', content, type: 'text/plain' });
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: UploadResult };
    expect(body.data.content).toBe(content);
  });

  it('uploadAny accepts files of any type', async () => {
    const form = makeForm({ name: 'data.bin', content: Buffer.from([0x01, 0x02, 0x03]), type: 'application/octet-stream' });
    // uploadAny → mutation (non-create) → POST /open/upload-any
    const res = await fetch(`${baseUrl}/open/upload-any`, {
      method: 'POST',
      body: form,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { filename: string; sizeBytes: number } };
    expect(body.data.filename).toBe('data.bin');
    expect(body.data.sizeBytes).toBe(3);
  });

  it('missing file field returns 400 — Zod rejects missing required field', async () => {
    const form = new FormData();
    form.append('description', 'no file here');
    const res = await fetch(`${baseUrl}/uploads/upload-file`, {
      method: 'POST',
      headers: { Authorization: 'Bearer user-token' },
      body: form,
    });
    expect(res.status).toBe(400);
  });
});

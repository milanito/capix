import { describe, it, expect } from 'vitest';
import { uploadedFile } from './multipart.js';
import { parseMultipart } from './multipart-parser.js';
import type { UploadedFile } from './multipart.js';
import * as FormData from 'form-data';

// ---------------------------------------------------------------------------
// uploadedFile() — Zod schema factory
// ---------------------------------------------------------------------------

describe('uploadedFile()', () => {
  const validFile: UploadedFile = {
    filename: 'photo.jpg',
    contentType: 'image/jpeg',
    sizeBytes: 1024,
    buffer: Buffer.from('fake content'),
  };

  it('accepts a valid UploadedFile', async () => {
    const schema = uploadedFile();
    const result = await schema.safeParseAsync(validFile);
    expect(result.success).toBe(true);
  });

  it('rejects a non-object', async () => {
    const schema = uploadedFile();
    const result = await schema.safeParseAsync('not a file');
    expect(result.success).toBe(false);
  });

  it('rejects a plain object without buffer', async () => {
    const schema = uploadedFile();
    const result = await schema.safeParseAsync({ filename: 'a', contentType: 'b', sizeBytes: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects file exceeding maxSize', async () => {
    const schema = uploadedFile({ maxSize: 500 });
    const bigFile: UploadedFile = { ...validFile, sizeBytes: 1000, buffer: Buffer.alloc(1000) };
    const result = await schema.safeParseAsync(bigFile);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/exceeds maximum/i);
    }
  });

  it('accepts file within maxSize', async () => {
    const schema = uploadedFile({ maxSize: 2048 });
    const result = await schema.safeParseAsync(validFile);
    expect(result.success).toBe(true);
  });

  it('rejects disallowed contentType', async () => {
    const schema = uploadedFile({ accept: ['image/png', 'image/gif'] });
    const result = await schema.safeParseAsync(validFile); // validFile has image/jpeg
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/not accepted/i);
    }
  });

  it('accepts allowed contentType', async () => {
    const schema = uploadedFile({ accept: ['image/jpeg', 'image/png'] });
    const result = await schema.safeParseAsync(validFile);
    expect(result.success).toBe(true);
  });

  it('accepts any type when accept is not set', async () => {
    const schema = uploadedFile();
    const exoticFile: UploadedFile = { ...validFile, contentType: 'application/x-custom' };
    const result = await schema.safeParseAsync(exoticFile);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseMultipart() — busboy-based parser
// ---------------------------------------------------------------------------

/** Build a multipart body from a FormData-like structure for testing. */
function buildMultipartBody(fields: Record<string, string>, files: Record<string, { content: string; filename: string; contentType: string }>): { headers: Record<string, string>; body: Buffer } {
  const form = new FormData.default();
  for (const [k, v] of Object.entries(fields)) {
    form.append(k, v);
  }
  for (const [k, { content, filename, contentType }] of Object.entries(files)) {
    form.append(k, Buffer.from(content), { filename, contentType });
  }
  return {
    headers: form.getHeaders() as Record<string, string>,
    body: form.getBuffer(),
  };
}

describe('parseMultipart()', () => {
  it('parses a single file', async () => {
    const { headers, body } = buildMultipartBody(
      {},
      { file: { content: 'hello world', filename: 'test.txt', contentType: 'text/plain' } },
    );
    const result = await parseMultipart(headers, body);
    expect(result.files['file']).toBeDefined();
    expect(result.files['file']!.filename).toBe('test.txt');
    expect(result.files['file']!.contentType).toBe('text/plain');
    expect(result.files['file']!.buffer.toString()).toBe('hello world');
    expect(result.files['file']!.sizeBytes).toBe(11);
  });

  it('parses file plus text fields', async () => {
    const { headers, body } = buildMultipartBody(
      { title: 'My Upload', tags: 'photo,nature' },
      { image: { content: 'binary', filename: 'img.png', contentType: 'image/png' } },
    );
    const result = await parseMultipart(headers, body);
    expect(result.fields['title']).toBe('My Upload');
    expect(result.fields['tags']).toBe('photo,nature');
    expect(result.files['image']!.contentType).toBe('image/png');
  });

  it('rejects file exceeding maxFileSize', async () => {
    const { headers, body } = buildMultipartBody(
      {},
      { file: { content: 'A'.repeat(200), filename: 'big.txt', contentType: 'text/plain' } },
    );
    await expect(parseMultipart(headers, body, { maxFileSize: 100 })).rejects.toMatchObject({ status: 413 });
  });

  it('rejects too many files', async () => {
    const form = new FormData.default();
    form.append('a', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' });
    form.append('b', Buffer.from('y'), { filename: 'b.txt', contentType: 'text/plain' });
    const headers = form.getHeaders() as Record<string, string>;
    const body = form.getBuffer();
    await expect(parseMultipart(headers, body, { maxFiles: 1 })).rejects.toMatchObject({ status: 400 });
  });

  it('uses field name as fallback when filename is empty', async () => {
    const form = new FormData.default();
    form.append('upload', Buffer.from('data'), { contentType: 'application/octet-stream' });
    const headers = form.getHeaders() as Record<string, string>;
    const body = form.getBuffer();
    const result = await parseMultipart(headers, body);
    expect(result.files['upload']).toBeDefined();
    // filename falls back to field name
    expect(result.files['upload']!.filename).toBe('upload');
  });

  it('returns empty fields and files for empty multipart', async () => {
    const form = new FormData.default();
    const headers = form.getHeaders() as Record<string, string>;
    const body = form.getBuffer();
    const result = await parseMultipart(headers, body);
    expect(result.fields).toEqual({});
    expect(result.files).toEqual({});
  });
});

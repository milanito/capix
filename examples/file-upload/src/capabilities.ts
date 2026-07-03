import { z } from 'zod';
import { capability, defineError, defineGuard } from '@capixjs/core';
import { uploadedFile } from '@capixjs/transport-rest';

export const errors = {
  Unauthorized: defineError(401, 'Unauthorized'),
  NotFound: defineError(404, 'Not found'),
};

type User = { id: string; name: string };

export type Context = { requestId: string; user: User | null };

// Pre-bind the context type so guards typed for Context are accepted
// without annotation — see "Typing your context" in the README.
const cap = capability.withContext<Context>();

export const mustBeUser = defineGuard(
  (ctx: Context): asserts ctx is Context & { user: User } => {
    if (!ctx.user) throw errors.Unauthorized();
  },
);

// In-memory registry for demonstration — keyed by upload id
const uploads = new Map<string, {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  description: string | null;
  uploadedAt: string;
}>();

export const createUpload = cap(
  z.object({
    file: uploadedFile({
      maxSize: 10 * 1024 * 1024,
      accept: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
    }),
    description: z.string().max(500).optional(),
  }),
  async ({ file, description }) => {
    const id = crypto.randomUUID();
    const record = {
      id,
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      description: description ?? null,
      uploadedAt: new Date().toISOString(),
    };
    uploads.set(id, record);
    // In production: write file.buffer to disk or object storage
    return record;
  },
).guard(mustBeUser);

export const getUpload = cap(
  z.object({ id: z.string() }),
  ({ id }) => {
    const record = uploads.get(id);
    if (!record) throw errors.NotFound({ resource: 'upload', id });
    return record;
  },
  'query',
).guard(mustBeUser);

export const listUploads = cap(
  z.object({}),
  () => Array.from(uploads.values()),
  'query',
).guard(mustBeUser);

export const capabilities = {
  uploads: { createUpload, getUpload, listUploads },
};

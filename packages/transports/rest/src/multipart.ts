/**
 * multipart.ts — UploadedFile type and Zod schema factory
 * Depends on: zod
 */

import { z } from 'zod';
import type { ZodType } from 'zod';

export type UploadedFile = {
  filename:    string;
  contentType: string;
  sizeBytes:   number;
  buffer:      Buffer;
};

export type MultipartOptions = {
  /** Max bytes per file. Default 5MB. */
  maxFileSize?: number;
  /** Max number of files per request. Default 1. */
  maxFiles?: number;
};

type UploadedFileOptions = {
  /** Max bytes for this specific field. Default 5MB. */
  maxSize?: number;
  /** Allowed MIME types. If omitted, all types are accepted. */
  accept?: string[];
};

/**
 * Zod schema for a file uploaded via multipart/form-data.
 * Use inside z.object() alongside regular fields.
 *
 * @example
 * z.object({
 *   file: uploadedFile({ maxSize: 2 * 1024 * 1024, accept: ['image/jpeg', 'image/png'] }),
 *   title: z.string(),
 * })
 */
export function uploadedFile(options: UploadedFileOptions = {}): ZodType<UploadedFile> {
  const maxSize = options.maxSize ?? 5 * 1024 * 1024;

  return z
    .custom<UploadedFile>(
      (val: unknown): val is UploadedFile =>
        typeof val === 'object' &&
        val !== null &&
        typeof (val as UploadedFile).filename === 'string' &&
        typeof (val as UploadedFile).contentType === 'string' &&
        typeof (val as UploadedFile).sizeBytes === 'number' &&
        Buffer.isBuffer((val as UploadedFile).buffer),
      { message: 'Expected an uploaded file' },
    )
    .superRefine((file: UploadedFile, ctx: z.RefinementCtx) => {
      if (file.sizeBytes > maxSize) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `File size ${file.sizeBytes} bytes exceeds maximum ${maxSize} bytes`,
        });
      }
      if (options.accept !== undefined && !options.accept.includes(file.contentType)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `File type '${file.contentType}' not accepted. Allowed: ${options.accept.join(', ')}`,
        });
      }
    });
}

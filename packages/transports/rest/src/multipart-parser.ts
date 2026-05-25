/**
 * multipart-parser.ts — busboy-based multipart/form-data parser
 * Depends on: busboy, multipart.ts
 */

import Busboy from 'busboy';
import type { IncomingHttpHeaders } from 'node:http';
import type { UploadedFile, MultipartOptions } from './multipart.js';

export type ParsedMultipart = {
  fields: Record<string, string>;
  files: Record<string, UploadedFile>;
};

type ParseError = Error & { status: number };

function parseError(message: string, status: number): ParseError {
  return Object.assign(new Error(message), { status });
}

/**
 * Parses a multipart/form-data body from an already-read Buffer.
 * Fields are returned as strings; files as UploadedFile objects.
 * Rejects with an error that has a `.status` property on limit violations.
 */
export function parseMultipart(
  headers: IncomingHttpHeaders,
  body: Buffer,
  options: MultipartOptions = {},
): Promise<ParsedMultipart> {
  const maxFileSize = options.maxFileSize ?? 5 * 1024 * 1024;
  const maxFiles = options.maxFiles ?? 1;

  return new Promise((resolve, reject) => {
    const fields: Record<string, string> = {};
    const files: Record<string, UploadedFile> = {};
    let fileCount = 0;
    let settled = false;

    function fail(err: ParseError): void {
      if (settled) return;
      settled = true;
      reject(err);
    }

    const busboy = Busboy({
      headers,
      limits: { fileSize: maxFileSize, files: maxFiles },
    });

    busboy.on('field', (name, value) => {
      fields[name] = value;
    });

    // Fired when the files limit is reached — busboy stops emitting 'file' events beyond this.
    busboy.on('filesLimit', () => {
      fail(parseError(`Too many files. Maximum is ${maxFiles}.`, 400));
    });

    busboy.on('file', (fieldName, stream, info) => {
      fileCount++;
      void fileCount; // counted for potential future use

      const chunks: Buffer[] = [];
      let truncated = false;

      stream.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      stream.on('limit', () => { truncated = true; });
      stream.on('end', () => {
        if (truncated) {
          fail(parseError(`File '${info.filename || fieldName}' exceeds ${maxFileSize} bytes.`, 413));
          return;
        }
        const buffer = Buffer.concat(chunks);
        files[fieldName] = {
          filename: info.filename || fieldName,
          contentType: info.mimeType || 'application/octet-stream',
          sizeBytes: buffer.byteLength,
          buffer,
        };
      });

      stream.on('error', (err: Error) => fail(Object.assign(err, { status: 400 })));
    });

    busboy.on('finish', () => {
      if (!settled) {
        settled = true;
        resolve({ fields, files });
      }
    });

    busboy.on('error', (err: Error) => fail(Object.assign(err, { status: 400 })));

    busboy.write(body);
    busboy.end();
  });
}

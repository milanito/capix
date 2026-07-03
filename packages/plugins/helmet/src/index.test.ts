import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { helmet, mergeHooks } from './index.js';

const req = {} as IncomingMessage;

function applyHooks(opts: ReturnType<typeof helmet>): Record<string, string> {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: vi.fn((name: string, value: string) => {
      headers[name] = value;
    }),
  } as unknown as ServerResponse;
  opts.hooks?.onRequest?.(req, res);
  return headers;
}

describe('helmet', () => {
  it('sets the default security headers', () => {
    const headers = applyHooks(helmet());
    expect(headers).toEqual({
      'Content-Security-Policy': "default-src 'self'",
      'X-Frame-Options': 'SAMEORIGIN',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    // Off by default — no meaningful universal value exists
    expect(headers).not.toHaveProperty('Permissions-Policy');
  });

  it('allows disabling individual headers with false', () => {
    const headers = applyHooks(helmet({
      contentSecurityPolicy: false,
      frameOptions: false,
      hsts: false,
      noSniff: false,
      referrerPolicy: false,
    }));
    expect(headers).toEqual({});
  });

  it('applies custom values', () => {
    const headers = applyHooks(helmet({
      frameOptions: 'DENY',
      referrerPolicy: 'same-origin',
      permissionsPolicy: 'camera=()',
    }));
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('same-origin');
    expect(headers['Permissions-Policy']).toBe('camera=()');
  });
});

describe('mergeHooks', () => {
  it('runs every hook set in order', () => {
    const calls: string[] = [];
    const a = { hooks: { onRequest: () => calls.push('a') } };
    const b = { hooks: { onRequest: () => calls.push('b') } };
    const merged = mergeHooks(a, b);
    merged.hooks?.onRequest?.(req, {} as ServerResponse);
    expect(calls).toEqual(['a', 'b']);
  });

  it('skips entries without hooks and returns {} when nothing remains', () => {
    expect(mergeHooks({}, {})).toEqual({});
  });

  it('combines helmet and custom hooks', () => {
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as ServerResponse;
    const custom = { hooks: { onRequest: (_r: IncomingMessage, rs: ServerResponse) => rs.setHeader('X-Custom', 'yes') } };
    mergeHooks(helmet(), custom).hooks?.onRequest?.(req, res);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Custom']).toBe('yes');
  });
});

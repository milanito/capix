import { describe, it, expect, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cors } from './index.js';

const req = {} as IncomingMessage;
function mockRes(): ServerResponse & { setHeader: ReturnType<typeof vi.fn> } {
  return { setHeader: vi.fn() } as unknown as ServerResponse & { setHeader: ReturnType<typeof vi.fn> };
}

describe('cors', () => {
  it('defaults to wildcard origin with no method/header overrides', () => {
    const opts = cors();
    expect(opts.cors?.origin).toBe('*');
    expect(opts.cors).not.toHaveProperty('methods');
    expect(opts.cors).not.toHaveProperty('headers');
  });

  it('passes a string origin through unchanged', () => {
    const opts = cors({ origin: 'https://app.example.com' });
    expect(opts.cors?.origin).toBe('https://app.example.com');
  });

  it('converts an origin array into a set-membership function', () => {
    const opts = cors({ origin: ['https://a.com', 'https://b.com'] });
    const fn = opts.cors?.origin as (o: string) => boolean;
    expect(fn('https://a.com')).toBe(true);
    expect(fn('https://b.com')).toBe(true);
    expect(fn('https://evil.com')).toBe(false);
  });

  it('passes a predicate origin through unchanged', () => {
    const predicate = (o: string): boolean => o.endsWith('.example.com');
    const opts = cors({ origin: predicate });
    expect(opts.cors?.origin).toBe(predicate);
  });

  it('forwards methods and headers overrides', () => {
    const opts = cors({ methods: 'GET, POST', headers: 'X-Custom' });
    expect(opts.cors?.methods).toBe('GET, POST');
    expect(opts.cors?.headers).toBe('X-Custom');
  });

  it('sets Vary: Origin for dynamic origins', () => {
    const res = mockRes();
    cors({ origin: ['https://a.com'] }).hooks?.onRequest?.(req, res);
    expect(res.setHeader).toHaveBeenCalledWith('Vary', 'Origin');
  });

  it('does not set Vary for static origins', () => {
    const res = mockRes();
    cors({ origin: '*' }).hooks?.onRequest?.(req, res);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('respects varyOrigin: false', () => {
    const res = mockRes();
    cors({ origin: ['https://a.com'], varyOrigin: false }).hooks?.onRequest?.(req, res);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});

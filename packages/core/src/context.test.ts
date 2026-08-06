import { describe, it, expect } from 'vitest';
import { defineContext, getHeader, flattenHeaders } from './context.js';
import type { RawRequest } from './context.js';

function makeReq(headers: Record<string, string | string[] | undefined> = {}): RawRequest {
  return {
    headers,
    method: 'GET',
    url: '/test',
    signal: AbortSignal.timeout(5000),
  };
}

describe('defineContext', () => {
  it('returns the builder unchanged', () => {
    const builder = async (req: RawRequest) => ({ requestId: req.url });
    expect(defineContext(builder)).toBe(builder);
  });

  it('builder is called with the raw request', async () => {
    const builder = defineContext(async (req) => ({ requestId: req.method }));
    const ctx = await builder(makeReq());
    expect(ctx.requestId).toBe('GET');
  });
});

describe('getHeader', () => {
  it('returns header value by exact name', () => {
    expect(getHeader(makeReq({ authorization: 'Bearer tok' }), 'authorization')).toBe('Bearer tok');
  });

  it('is case-insensitive', () => {
    expect(getHeader(makeReq({ 'Content-Type': 'application/json' }), 'content-type')).toBe(
      'application/json',
    );
    expect(getHeader(makeReq({ 'content-type': 'text/plain' }), 'Content-Type')).toBe('text/plain');
  });

  it('returns first element when header is an array', () => {
    expect(getHeader(makeReq({ 'x-ids': ['a', 'b', 'c'] }), 'x-ids')).toBe('a');
  });

  it('returns undefined when header is absent', () => {
    expect(getHeader(makeReq({}), 'authorization')).toBeUndefined();
  });

  it('returns undefined when header value is undefined', () => {
    expect(getHeader(makeReq({ 'x-empty': undefined }), 'x-empty')).toBeUndefined();
  });
});

describe('flattenHeaders', () => {
  it('passes single string values through unchanged', () => {
    expect(flattenHeaders({ authorization: 'Bearer tok' })).toEqual({ authorization: 'Bearer tok' });
  });

  it('joins array values with a comma and space', () => {
    expect(flattenHeaders({ 'x-ids': ['a', 'b', 'c'] })).toEqual({ 'x-ids': 'a, b, c' });
  });

  it('drops keys whose value is undefined', () => {
    expect(flattenHeaders({ 'x-empty': undefined, 'x-present': 'yes' })).toEqual({ 'x-present': 'yes' });
  });

  it('returns an empty object for an empty input', () => {
    expect(flattenHeaders({})).toEqual({});
  });

  it('preserves key casing (case-sensitivity is the caller\'s concern)', () => {
    expect(flattenHeaders({ 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json' });
  });
});

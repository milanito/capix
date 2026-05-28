import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JWTCache } from './jwt-cache.js';

describe('JWTCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for a miss', () => {
    const cache = new JWTCache<string>();
    expect(cache.get('unknown')).toBeUndefined();
  });

  it('stores and retrieves a value', () => {
    const cache = new JWTCache<string>({ ttl: 5000 });
    cache.set('tok1', 'alice');
    expect(cache.get('tok1')).toBe('alice');
  });

  it('returns undefined after TTL expires', () => {
    const cache = new JWTCache<string>({ ttl: 1000 });
    cache.set('tok1', 'alice');
    vi.advanceTimersByTime(1001);
    expect(cache.get('tok1')).toBeUndefined();
  });

  it('returns value before TTL expires', () => {
    const cache = new JWTCache<string>({ ttl: 2000 });
    cache.set('tok1', 'alice');
    vi.advanceTimersByTime(1999);
    expect(cache.get('tok1')).toBe('alice');
  });

  it('evicts oldest entry when maxSize reached', () => {
    const cache = new JWTCache<string>({ ttl: 60000, maxSize: 2 });
    cache.set('tok1', 'alice');
    cache.set('tok2', 'bob');
    cache.set('tok3', 'carol'); // evicts tok1
    expect(cache.get('tok1')).toBeUndefined();
    expect(cache.get('tok2')).toBe('bob');
    expect(cache.get('tok3')).toBe('carol');
  });

  it('size reflects current entry count', () => {
    const cache = new JWTCache<number>({ ttl: 60000, maxSize: 10 });
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  it('clear removes all entries', () => {
    const cache = new JWTCache<string>({ ttl: 60000 });
    cache.set('tok1', 'alice');
    cache.set('tok2', 'bob');
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('tok1')).toBeUndefined();
  });

  it('ttl: 0 disables caching (set is no-op)', () => {
    const cache = new JWTCache<string>({ ttl: 0 });
    cache.set('tok1', 'alice');
    expect(cache.get('tok1')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('stores null values (invalid tokens)', () => {
    const cache = new JWTCache<string | null>({ ttl: 5000 });
    cache.set('invalid', null);
    expect(cache.get('invalid')).toBeNull();
  });

  it('LRU: recently-accessed entries are not evicted first', () => {
    const cache = new JWTCache<string>({ ttl: 60000, maxSize: 2 });
    cache.set('tok1', 'alice');
    cache.set('tok2', 'bob');
    cache.get('tok1'); // refresh tok1
    cache.set('tok3', 'carol'); // should evict tok2 (oldest access)
    expect(cache.get('tok1')).toBe('alice');
    expect(cache.get('tok2')).toBeUndefined();
    expect(cache.get('tok3')).toBe('carol');
  });
});

import { describe, it, expect } from 'vitest';
import { defineError, isFrameworkError, defaultErrors } from './errors.js';

describe('defineError', () => {
  it('produces correct status, error name, and message', () => {
    const factory = defineError(404, 'Not found');
    const err = factory();
    expect(err.status).toBe(404);
    expect(err.error).toBe('NotFound');
    expect(err.message).toBe('Not found');
  });

  it('derives PascalCase error name from multi-word message', () => {
    const factory = defineError(500, 'Internal server error');
    expect(factory().error).toBe('InternalServerError');
  });

  it('includes meta when provided', () => {
    const factory = defineError(404, 'Not found');
    const err = factory({ resource: 'user', id: '123' });
    expect(err.meta).toEqual({ resource: 'user', id: '123' });
  });

  it('omits meta when not provided', () => {
    const factory = defineError(404, 'Not found');
    const err = factory();
    expect('meta' in err).toBe(false);
  });
});

describe('isFrameworkError', () => {
  it('returns true for factory output', () => {
    const factory = defineError(404, 'Not found');
    expect(isFrameworkError(factory())).toBe(true);
  });

  it('returns false for plain objects with matching shape', () => {
    expect(isFrameworkError({ status: 404, error: 'NotFound', message: 'Not found' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFrameworkError(null)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isFrameworkError('error')).toBe(false);
    expect(isFrameworkError(404)).toBe(false);
  });
});

describe('defaultErrors', () => {
  it('BadRequest has status 400', () => {
    expect(defaultErrors.BadRequest().status).toBe(400);
  });

  it('Unauthorized has status 401', () => {
    expect(defaultErrors.Unauthorized().status).toBe(401);
  });

  it('Forbidden has status 403', () => {
    expect(defaultErrors.Forbidden().status).toBe(403);
  });

  it('NotFound has status 404', () => {
    expect(defaultErrors.NotFound().status).toBe(404);
  });

  it('Conflict has status 409', () => {
    expect(defaultErrors.Conflict().status).toBe(409);
  });

  it('TooManyRequests has status 429', () => {
    expect(defaultErrors.TooManyRequests().status).toBe(429);
  });

  it('Internal has status 500', () => {
    expect(defaultErrors.Internal().status).toBe(500);
  });

  it('Timeout has status 504', () => {
    expect(defaultErrors.Timeout().status).toBe(504);
  });
});

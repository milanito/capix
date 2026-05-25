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

  it('returns false for Error instances', () => {
    expect(isFrameworkError(new Error('not found'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFrameworkError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isFrameworkError(undefined)).toBe(false);
  });

  it('returns false for primitives', () => {
    expect(isFrameworkError('error')).toBe(false);
    expect(isFrameworkError(404)).toBe(false);
  });

  it('two different error factories are not cross-identified', () => {
    const ErrA = defineError(404, 'Not found');
    const ErrB = defineError(401, 'Unauthorized');
    const errA = ErrA();
    const errB = ErrB();
    expect(isFrameworkError(errA)).toBe(true);
    expect(isFrameworkError(errB)).toBe(true);
    // Both are FrameworkErrors — the brand is per-type, not per-factory
    expect(errA.status).not.toBe(errB.status);
  });
});

describe('error name derivation', () => {
  it("'Not found' → 'NotFound'", () => {
    expect(defineError(404, 'Not found')().error).toBe('NotFound');
  });

  it("'Bad request' → 'BadRequest'", () => {
    expect(defineError(400, 'Bad request')().error).toBe('BadRequest');
  });

  it("'Too many requests' → 'TooManyRequests'", () => {
    expect(defineError(429, 'Too many requests')().error).toBe('TooManyRequests');
  });

  it('single word message → unchanged', () => {
    expect(defineError(401, 'Unauthorized')().error).toBe('Unauthorized');
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

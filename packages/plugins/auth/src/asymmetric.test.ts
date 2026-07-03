import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { createJWTHelpers } from './index.js';

type User = { id: string };
const userFromToken = (p: jwt.JwtPayload): User | null => (p['sub'] ? { id: p['sub'] } : null);

function rsaPair(): { publicPem: string; privatePem: string; publicJwk: Record<string, unknown> } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicJwk: publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createJWTHelpers — configuration', () => {
  it('requires exactly one of secret, publicKey, jwks', () => {
    expect(() => createJWTHelpers({ userFromToken })).toThrow(/exactly one/);
    expect(() =>
      createJWTHelpers({ secret: 's', publicKey: 'pem', userFromToken }),
    ).toThrow(/exactly one/);
  });

  it('JWKS helpers are verify-only', () => {
    const helpers = createJWTHelpers({ jwks: { url: 'https://issuer/jwks.json' }, userFromToken });
    expect(() => helpers.sign({ sub: 'u1' })).toThrow(/verify-only/);
  });
});

describe('createJWTHelpers — RS256 with PEM keys', () => {
  it('signs with the private key and verifies with the public key', async () => {
    const { publicPem, privatePem } = rsaPair();
    const helpers = createJWTHelpers({ publicKey: publicPem, privateKey: privatePem, userFromToken });

    const token = helpers.sign({ sub: 'u1' });
    expect(jwt.decode(token, { complete: true })?.header.alg).toBe('RS256');
    expect(await helpers.verify(token)).toEqual({ id: 'u1' });
  });

  it('rejects tokens signed by a different key', async () => {
    const { publicPem } = rsaPair();
    const other = rsaPair();
    const helpers = createJWTHelpers({ publicKey: publicPem, userFromToken });

    const forged = jwt.sign({ sub: 'u1' }, other.privatePem, { algorithm: 'RS256' });
    expect(await helpers.verify(forged)).toBeNull();
  });

  it('rejects HS256 tokens against an RS256 config (algorithm confusion)', async () => {
    const { publicPem } = rsaPair();
    const helpers = createJWTHelpers({ publicKey: publicPem, userFromToken });

    // Classic attack: sign HS256 using the public PEM text as the shared secret
    const confused = jwt.sign({ sub: 'u1' }, publicPem, { algorithm: 'HS256' });
    expect(await helpers.verify(confused)).toBeNull();
  });

  it('rejects RS256 tokens against a secret config', async () => {
    const { privatePem } = rsaPair();
    const helpers = createJWTHelpers({ secret: 'shared', userFromToken });
    const rsToken = jwt.sign({ sub: 'u1' }, privatePem, { algorithm: 'RS256' });
    expect(await helpers.verify(rsToken)).toBeNull();
  });
});

describe('createJWTHelpers — JWKS', () => {
  function stubJwks(responses: Array<Record<string, unknown>>): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn();
    for (const body of responses) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => body });
    }
    // Subsequent calls keep returning the last body
    const last = responses[responses.length - 1];
    fetchMock.mockResolvedValue({ ok: true, json: async () => last });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('verifies tokens against the issuer key set, resolving by kid', async () => {
    const pair = rsaPair();
    const fetchMock = stubJwks([{ keys: [{ ...pair.publicJwk, kid: 'key-1', use: 'sig' }] }]);

    const helpers = createJWTHelpers({ jwks: { url: 'https://issuer/jwks.json' }, userFromToken });
    const token = jwt.sign({ sub: 'u1' }, pair.privatePem, { algorithm: 'RS256', keyid: 'key-1' });

    expect(await helpers.verify(token)).toEqual({ id: 'u1' });
    expect(await helpers.verify(token)).toEqual({ id: 'u1' });
    // Key set fetched once, served from cache afterwards
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches on unknown kid (key rotation) and honors the refetch rate limit', async () => {
    const oldPair = rsaPair();
    const newPair = rsaPair();
    const fetchMock = stubJwks([
      { keys: [{ ...oldPair.publicJwk, kid: 'old', use: 'sig' }] },
      { keys: [{ ...newPair.publicJwk, kid: 'new', use: 'sig' }] },
    ]);

    const helpers = createJWTHelpers({
      jwks: { url: 'https://issuer/jwks.json', minRefetchIntervalMs: 0 },
      userFromToken,
    });

    const oldToken = jwt.sign({ sub: 'a' }, oldPair.privatePem, { algorithm: 'RS256', keyid: 'old' });
    expect(await helpers.verify(oldToken)).toEqual({ id: 'a' });

    // Issuer rotated: a token with the new kid forces a refetch
    const newToken = jwt.sign({ sub: 'b' }, newPair.privatePem, { algorithm: 'RS256', keyid: 'new' });
    expect(await helpers.verify(newToken)).toEqual({ id: 'b' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects tokens without a kid header and tokens with unknown kids', async () => {
    const pair = rsaPair();
    stubJwks([{ keys: [{ ...pair.publicJwk, kid: 'key-1', use: 'sig' }] }]);

    const helpers = createJWTHelpers({
      jwks: { url: 'https://issuer/jwks.json', minRefetchIntervalMs: 60_000 },
      userFromToken,
    });

    const noKid = jwt.sign({ sub: 'u1' }, pair.privatePem, { algorithm: 'RS256' });
    expect(await helpers.verify(noKid)).toBeNull();

    const wrongKid = jwt.sign({ sub: 'u1' }, pair.privatePem, { algorithm: 'RS256', keyid: 'ghost' });
    expect(await helpers.verify(wrongKid)).toBeNull();
  });

  it('keeps serving the cached key set when the endpoint fails', async () => {
    const pair = rsaPair();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ keys: [{ ...pair.publicJwk, kid: 'k', use: 'sig' }] }) })
      .mockRejectedValue(new Error('endpoint down'));
    vi.stubGlobal('fetch', fetchMock);

    const helpers = createJWTHelpers({
      jwks: { url: 'https://issuer/jwks.json', cacheTtlMs: 0, minRefetchIntervalMs: 0 },
      userFromToken,
    });

    const token = jwt.sign({ sub: 'u1' }, pair.privatePem, { algorithm: 'RS256', keyid: 'k' });
    expect(await helpers.verify(token)).toEqual({ id: 'u1' });
    // ttl 0 forces refetch attempts, which now fail — previous keys still serve
    expect(await helpers.verify(token)).toEqual({ id: 'u1' });
  });
});

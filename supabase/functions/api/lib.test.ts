import { describe, expect, it } from 'vitest';
import { allowedOrigin, apiPath, base64url, fromBase64url, lwwMerge, SESSION_SECONDS, signJWT, validTimestamp, verifyJWT, type SyncItem } from './lib';

const secret = 'a-test-only-secret-of-at-least-32-bytes';
const sub = '0b968ec8-c707-4d38-97e3-ea737e91064d';
describe('session JWT', () => {
  it('signs an interoperable HS256 JWT for 60 days', async () => {
    const token = await signJWT(sub, secret, 1000);
    expect(await verifyJWT(token, secret, 1000)).toBe(sub);
    const [header, body, signature] = token.split('.');
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(header)))).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(JSON.parse(new TextDecoder().decode(fromBase64url(body)))).toEqual({ sub, iat: 1000, exp: 1000 + SESSION_SECONDS });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    expect(await crypto.subtle.verify('HMAC', key, fromBase64url(signature), new TextEncoder().encode(`${header}.${body}`))).toBe(true);
    expect(await verifyJWT(token, secret, 1000 + SESSION_SECONDS - 1)).toBe(sub);
    expect(await verifyJWT(token, secret, 1000 + SESSION_SECONDS)).toBeNull();
    expect(await verifyJWT(token, secret, 999)).toBeNull();
  });
  it('rejects tampering, wrong secrets, malformed tokens and invalid subjects', async () => {
    const token = await signJWT(sub, secret);
    const [header, body, sig] = token.split('.');
    expect(await verifyJWT(`${header}.${base64url(new TextEncoder().encode('{}'))}.${sig}`, secret)).toBeNull();
    expect(await verifyJWT(token, secret + 'wrong')).toBeNull();
    expect(await verifyJWT(`${header}.${body}.${sig}.extra`, secret)).toBeNull();
    expect(await verifyJWT('bad.token.!!!', secret)).toBeNull();
    expect(await verifyJWT(await signJWT('not-a-uuid', secret), secret)).toBeNull();
    const none = base64url(new TextEncoder().encode('{"alg":"none","typ":"JWT"}'));
    expect(await verifyJWT(`${none}.${body}.`, secret)).toBeNull();
    await expect(signJWT(sub, 'short')).rejects.toThrow('32 bytes');
  });
});
describe('base64url', () => {
  it('round trips arbitrary bytes without padding or standard base64 symbols', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(fromBase64url(base64url(bytes))).toEqual(bytes);
    expect(base64url(new Uint8Array([255, 254, 253]))).toBe('__79');
    expect(base64url(new Uint8Array())).toBe('');
    expect(fromBase64url('YQ')).toEqual(new Uint8Array([97]));
    expect(() => fromBase64url('a')).toThrow();
    expect(() => fromBase64url('ab+/')).toThrow();
  });
});
describe('origin allowlist', () => {
  const origins = 'https://example.com, http://localhost:5173';
  it('requires an exact origin including port and scheme', () => {
    expect(allowedOrigin('https://example.com', origins)).toBe(true);
    expect(allowedOrigin('http://localhost:5173', origins)).toBe(true);
    for (const origin of [null, 'null', 'https://example.com.attacker.test', 'http://example.com', 'https://example.com:123', 'https://example.com/', 'https://example.com/path', 'https://example.com@evil.test', '*']) {
      expect(allowedOrigin(origin, origins)).toBe(false);
    }
    expect(allowedOrigin('https://evil.test', '*')).toBe(false);
  });
});
describe('mount parsing', () => {
  it.each([
    ['/functions/v1/api/auth/login/options', '/auth/login/options'],
    ['/api/sync/pull/', '/sync/pull'], ['/me', '/me'], ['/api', '/'],
    ['/functions/v1/api', '/'], ['/capitol/apiary', '/capitol/apiary'],
    ['/api/auth/passkeys/api', '/auth/passkeys/api'],
  ])('%s -> %s', (input, expected) => expect(apiPath(input)).toBe(expected));
});
describe('LWW merge', () => {
  const old: SyncItem = { collection: 'games', key: '1', data: { score: 1 }, updated_at: '2026-11-05T10:00:00.000Z' };
  it('inserts new rows and retains the stored row on stale writes or ties', () => {
    expect(lwwMerge(undefined, old)).toBe(old);
    expect(lwwMerge(old, { ...old, data: 9 })).toBe(old);
    expect(lwwMerge(old, { ...old, updated_at: '2026-11-04T10:00:00Z' })).toBe(old);
  });
  it('preserves tombstones and accepts newer resurrected values', () => {
    const tombstone = { ...old, data: null, deleted: true, updated_at: '2026-11-05T10:00:01Z' };
    expect(lwwMerge(old, tombstone)).toBe(tombstone);
    expect(lwwMerge(tombstone, old)).toBe(tombstone);
    const revived = { ...old, updated_at: '2026-11-05T10:00:02Z' };
    expect(lwwMerge(tombstone, revived)).toBe(revived);
  });
  it('compares instants across timezones and at Postgres microsecond precision', () => {
    expect(lwwMerge(old, { ...old, updated_at: '2026-11-05T11:00:00+01:00' })).toBe(old);
    const newer = { ...old, updated_at: '2026-11-05T10:00:00.000001Z' };
    expect(lwwMerge(old, newer)).toBe(newer);
    expect(lwwMerge(newer, old)).toBe(newer);
  });
});
describe('sync timestamp validation', () => {
  it('requires a timezone and supports microseconds', () => {
    expect(validTimestamp('2026-11-05T10:00:00.000001Z')).toBe(true);
    expect(validTimestamp('2026-11-05T11:00:00+01:00')).toBe(true);
    for (const value of [null, 9, 'yesterday', '2026-11-05', '2026-11-05T10:00:00', '2026-99-99T10:00:00Z', '2026-02-31T10:00:00Z', '2026-11-05T24:00:00Z', '2026-11-05T10:00:00+15:00']) expect(validTimestamp(value)).toBe(false);
  });
});

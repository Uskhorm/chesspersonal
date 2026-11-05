const encoder = new TextEncoder();
export const SESSION_SECONDS = 60 * 24 * 60 * 60;

export function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error('Invalid base64url');
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
}
async function hmacKey(secret: string) {
  if (encoder.encode(secret).length < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  return await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signJWT(sub: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = base64url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64url(encoder.encode(JSON.stringify({ sub, iat: now, exp: now + SESSION_SECONDS })));
  const input = `${head}.${body}`;
  return `${input}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(input))))}`;
}
export async function verifyJWT(token: string, secret: string, now = Math.floor(Date.now() / 1000)): Promise<string | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, signature] = parts;
    const header = JSON.parse(new TextDecoder().decode(fromBase64url(head)));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    if (!await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(signature), encoder.encode(`${head}.${body}`))) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    return typeof claims.sub === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.sub)
      && Number.isFinite(claims.exp) && claims.exp > now && Number.isFinite(claims.iat) && claims.iat <= now ? claims.sub : null;
  } catch { return null; }
}
export function allowedOrigin(origin: string | null, configured: string): boolean {
  if (!origin || origin === 'null') return false;
  try {
    const url = new URL(origin);
    return url.origin === origin && ['https:', 'http:'].includes(url.protocol)
      && configured.split(',').map(s => s.trim()).includes(origin);
  } catch { return false; }
}
export function apiPath(pathname: string): string {
  const parts = pathname.split('/');
  const mount = parts.indexOf('api');
  const path = mount < 0 ? pathname : '/' + parts.slice(mount + 1).join('/');
  return path.length > 1 ? path.replace(/\/+$/, '') : path || '/';
}
export interface SyncItem { collection: string; key: string; data: unknown; updated_at: string; deleted?: boolean }
// Matches Postgres timestamptz precision, including timestamps that differ within one millisecond.
function timestampMicros(value: string): bigint {
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value)) * 1000n + BigInt((fraction.slice(3, 6) + '000').slice(0, 3));
}
export function lwwMerge(current: SyncItem | undefined, incoming: SyncItem): SyncItem {
  return !current || timestampMicros(incoming.updated_at) > timestampMicros(current.updated_at) ? incoming : current;
}
export function validTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,6})?(?:Z|[+-](\d\d):(\d\d))$/.exec(value);
  if (!match || +match[2] > 23 || +match[3] > 59 || +match[4] > 59
    || +(match[5] ?? 0) > 14 || +(match[6] ?? 0) > 59 || (+match[5] === 14 && +match[6] !== 0)
    || !Number.isFinite(Date.parse(value))) return false;
  // Date.parse normalizes impossible calendar days such as February 31; Postgres rejects them.
  return new Date(`${match[1]}T00:00:00Z`).toISOString().slice(0, 10) === match[1];
}

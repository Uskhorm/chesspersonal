import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type RegistrationResponseJSON, type AuthenticationResponseJSON, type AuthenticatorTransportFuture,
} from 'npm:@simplewebauthn/server@13';
import { allowedOrigin, apiPath, base64url, fromBase64url, signJWT, verifyJWT, validTimestamp } from './lib.ts';

function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
const secret = env('SESSION_SECRET');
if (new TextEncoder().encode(secret).length < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
const origins = env('ALLOWED_ORIGINS');
const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});
class HTTPError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
function fail(status: number, code: string): never { throw new HTTPError(status, code); }
async function result<T>(query: PromiseLike<{ data: T; error: { code?: string; message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) {
    if (error.code === '23505' || error.message === 'exists') fail(409, 'exists');
    // Do not leak SQL, profile data, or credential material to logs/clients.
    console.error('Database request failed', error.code);
    fail(500, 'database_error');
  }
  return data;
}
const userFields = 'id,username,display_name,avatar';
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function userFor(id: string) {
  const user = await result(db.from('users').select(userFields).eq('id', id).maybeSingle());
  if (!user) fail(401, 'unauthorized');
  return user;
}
async function profile(username: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(username)}`, {
      headers: { 'User-Agent': 'Hindsight/1.0' }, signal: AbortSignal.timeout(10000),
    });
  } catch { fail(502, 'chesscom_unavailable'); }
  // chess.com answers 404 (or 410 for closed accounts, and sometimes other 4xx from cloud IPs) for unknown players.
  if (response.status >= 400 && response.status < 500 && response.status !== 429) fail(400, 'not_found');
  if (!response.ok) fail(502, 'chesscom_unavailable');
  try { return await response.json(); } catch { fail(502, 'chesscom_unavailable'); }
}
async function body(req: Request): Promise<Record<string, unknown>> {
  const max = 4 * 1024 * 1024;
  if (Number(req.headers.get('Content-Length')) > max) fail(413, 'payload_too_large');
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); fail(413, 'payload_too_large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'invalid_body');
    return parsed;
  } catch { fail(400, 'invalid_body'); }
}
async function saveChallenge(challenge: string, origin: string, kind: string, userId?: string, username?: string) {
  const data = await result(db.from('challenges').insert({
    challenge: JSON.stringify({ challenge, origin }), kind, user_id: userId, username,
    expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
  }).select('id').single());
  if (!data) fail(500, 'database_error');
  return data.id;
}
async function consumeChallenge(id: unknown, kind: string, origin: string, userId?: string) {
  if (!uuid(id)) fail(400, 'invalid_challenge');
  // DELETE RETURNING consumes exactly once even under concurrent verification.
  let query = db.from('challenges').delete().eq('id', id).eq('kind', kind).gt('expires_at', new Date().toISOString());
  if (userId) query = query.eq('user_id', userId);
  const row = await result(query.select('*').maybeSingle());
  if (!row) fail(400, 'invalid_challenge');
  const stored = JSON.parse(row.challenge);
  if (stored.origin !== origin) fail(400, 'invalid_challenge');
  return { ...row, challenge: stored.challenge as string };
}
async function webauthn<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch { fail(400, 'invalid_passkey'); }
}

Deno.serve(async req => {
  const origin = req.headers.get('Origin');
  const cors = new Headers({ 'Vary': 'Origin', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });
  try {
    if (!allowedOrigin(origin, origins)) fail(403, 'origin_not_allowed');
    cors.set('Access-Control-Allow-Origin', origin!);
    cors.set('Access-Control-Allow-Headers', 'authorization, content-type, apikey, x-client-info');
    cors.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const rpID = new URL(origin!).hostname;
    const path = apiPath(new URL(req.url).pathname);
    const route = `${req.method} ${path}`;
    const publicRoutes = ['POST /auth/register/options', 'POST /auth/register/verify', 'POST /auth/login/options', 'POST /auth/login/verify'];
    let userId: string | undefined;
    if (!publicRoutes.includes(route)) {
      const bearer = /^Bearer ([^\s]+)$/i.exec(req.headers.get('Authorization') ?? '')?.[1];
      userId = bearer ? await verifyJWT(bearer, secret) ?? undefined : undefined;
      if (!userId) fail(401, 'unauthorized');
      await userFor(userId);
    }
    const input = req.method === 'POST' ? await body(req) : {};
    if (path.startsWith('/auth/')) await result(db.rpc('cleanup_challenges'));

    if (route === 'POST /auth/register/options' || route === 'POST /auth/passkeys/options') {
      const registering = path === '/auth/register/options';
      let username: string;
      let id: string;
      if (registering) {
        if (typeof input.username !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.username.trim())) fail(400, 'invalid_username');
        username = input.username.trim().toLowerCase();
        await profile(username);
        const existing = await result(db.from('users').select('id').eq('username', username).maybeSingle());
        id = existing?.id ?? crypto.randomUUID();
      } else {
        const user = await userFor(userId!);
        username = user.username; id = userId!;
      }
      const keys = await result(db.from('passkeys').select('id,transports').eq('user_id', id)) ?? [];
      if (registering && keys.length) fail(409, 'exists');
      const options = await generateRegistrationOptions({
        rpName: 'Hindsight', rpID, userName: username, userID: new TextEncoder().encode(id),
        attestationType: 'none',
        authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
        excludeCredentials: keys.map(k => ({ id: k.id, transports: k.transports as AuthenticatorTransportFuture[] })),
      });
      return json({ challengeId: await saveChallenge(options.challenge, origin!, registering ? 'register' : 'add', id, username), options });
    }
    if (route === 'POST /auth/register/verify' || route === 'POST /auth/passkeys/verify') {
      const registering = path === '/auth/register/verify';
      const challenge = await consumeChallenge(input.challengeId, registering ? 'register' : 'add', origin!, registering ? undefined : userId);
      if (!input.response || typeof input.response !== 'object') fail(400, 'invalid_passkey');
      if (input.deviceName !== undefined && (typeof input.deviceName !== 'string' || input.deviceName.length > 200)) fail(400, 'invalid_device_name');
      const verification = await webauthn(() => verifyRegistrationResponse({
        response: input.response as RegistrationResponseJSON, expectedChallenge: challenge.challenge,
        expectedOrigin: origin!, expectedRPID: rpID, requireUserVerification: false,
      }));
      if (!verification.verified || !verification.registrationInfo) fail(400, 'invalid_passkey');
      const credential = verification.registrationInfo.credential;
      const chessProfile = registering ? await profile(challenge.username) : {};
      const user = await result(db.rpc('save_passkey', {
        p_user_id: challenge.user_id, p_username: challenge.username, p_profile: chessProfile, p_register: registering,
        p_credential: { id: credential.id, public_key: base64url(credential.publicKey), counter: credential.counter,
          transports: credential.transports ?? [], device_name: input.deviceName ?? null },
      }));
      return json(registering ? { token: await signJWT(user.id, secret), user } : { ok: true });
    }
    if (route === 'POST /auth/login/options') {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
      return json({ challengeId: await saveChallenge(options.challenge, origin!, 'login'), options });
    }
    if (route === 'POST /auth/login/verify') {
      const challenge = await consumeChallenge(input.challengeId, 'login', origin!);
      const response = input.response as AuthenticationResponseJSON | undefined;
      if (!response || typeof response.id !== 'string') fail(400, 'invalid_passkey');
      const key = await result(db.from('passkeys').select('*').eq('id', response.id).maybeSingle());
      if (!key) fail(400, 'invalid_passkey');
      const expectedHandle = base64url(new TextEncoder().encode(key.user_id));
      if (response.response?.userHandle && response.response.userHandle !== expectedHandle) fail(400, 'invalid_passkey');
      const verification = await webauthn(() => verifyAuthenticationResponse({
        response, expectedChallenge: challenge.challenge, expectedOrigin: origin!, expectedRPID: rpID,
        requireUserVerification: false,
        credential: { id: key.id, publicKey: fromBase64url(key.public_key), counter: Number(key.counter), transports: key.transports },
      }));
      if (!verification.verified) fail(400, 'invalid_passkey');
      // Optimistic counter comparison rejects concurrent stale assertions. Counter-zero synced passkeys remain supported.
      const updated = await result(db.from('passkeys').update({ counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString() }).eq('id', key.id).eq('counter', key.counter).select('id').maybeSingle());
      if (!updated) fail(409, 'retry_login');
      const user = await userFor(key.user_id);
      return json({ token: await signJWT(user.id, secret), user });
    }
    if (route === 'GET /me') return json({ user: await userFor(userId!) });
    if (route === 'GET /auth/passkeys') return json(await result(db.from('passkeys')
      .select('id,device_name,created_at,last_used_at').eq('user_id', userId!).order('created_at')));
    if (req.method === 'DELETE' && /^\/auth\/passkeys\/[^/]+$/.test(path)) {
      const id = decodeURIComponent(path.split('/').at(-1)!);
      const status = await result(db.rpc('remove_passkey', { p_user_id: userId, p_id: id }));
      if (status !== 'ok') fail(status === 'not_found' ? 404 : 409, status);
      return json({ ok: true });
    }
    if (route === 'POST /sync/pull') {
      if (input.since !== undefined && !validTimestamp(input.since)) fail(400, 'invalid_since');
      let cursor: unknown = null;
      if (input.cursor !== undefined) {
        try { cursor = JSON.parse(new TextDecoder().decode(fromBase64url(String(input.cursor)))); }
        catch { fail(400, 'invalid_cursor'); }
        const c = cursor as Record<string, unknown> | null;
        if (!c || !validTimestamp(c.updated_at) || typeof c.collection !== 'string' || typeof c.key !== 'string') fail(400, 'invalid_cursor');
      }
      const page = await result(db.rpc('sync_pull', { p_user_id: userId, p_since: input.since ?? null, p_cursor: cursor }));
      return json({ ...page, cursor: page.cursor ? base64url(new TextEncoder().encode(JSON.stringify(page.cursor))) : null });
    }
    if (route === 'POST /sync/push') {
      if (!Array.isArray(input.items) || input.items.length > 200) fail(400, 'invalid_items');
      for (const item of input.items) {
        if (!item || typeof item !== 'object' || typeof item.collection !== 'string' || !item.collection.length || item.collection.length > 200
          || typeof item.key !== 'string' || !item.key.length || item.key.length > 1024 || !('data' in item)
          || !validTimestamp(item.updated_at) || (item.deleted !== undefined && typeof item.deleted !== 'boolean')) fail(400, 'invalid_item');
      }
      await result(db.rpc('sync_push', { p_user_id: userId, p_items: input.items }));
      return json({ ok: true, now: new Date().toISOString() });
    }
    fail(404, 'not_found');
  } catch (error) {
    if (error instanceof HTTPError) return json({ error: error.code }, error.status);
    console.error('Unhandled API failure', error instanceof Error ? error.name : 'unknown');
    return json({ error: 'internal_error' }, 500);
  }
});

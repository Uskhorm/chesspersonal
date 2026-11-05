import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registration: vi.fn(), authentication: vi.fn(), supported: vi.fn(),
  autofill: vi.fn(), platform: vi.fn(), cancel: vi.fn(),
  connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(),
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: mocks.registration,
  startAuthentication: mocks.authentication,
  browserSupportsWebAuthn: mocks.supported,
  browserSupportsWebAuthnAutofill: mocks.autofill,
  platformAuthenticatorIsAvailable: mocks.platform,
  WebAuthnAbortService: { cancelCeremony: mocks.cancel },
}));
vi.mock('../store', () => ({ useStore: { getState: () => ({ connect: mocks.connect, disconnect: mocks.disconnect }) } }));
// M3 may not yet exist in the shared checkout.
vi.mock('../cloudsync', () => ({ start: mocks.start, stop: mocks.stop }));

const user = { id: 'player-1', username: 'chessplayer', avatar: null, display_name: 'Chess Player' };
const registrationOptions = { challenge: 'register-challenge' };
const loginOptions = { challenge: 'login-challenge' };
const credential = { id: 'credential-1', response: {} };
const fetchMock = vi.fn();
let storage: Map<string, string>;

function reply(data: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('VITE_API_URL', 'https://example.test/api/');
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  vi.stubGlobal('fetch', fetchMock);
  mocks.supported.mockReturnValue(true);
  mocks.platform.mockResolvedValue(true);
  mocks.autofill.mockResolvedValue(true);
  mocks.registration.mockResolvedValue(credential);
  mocks.authentication.mockResolvedValue(credential);
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('passkey auth', () => {
  it('signs up, persists the session, connects the player and starts sync', async () => {
    reply({ challengeId: 'register-1', options: registrationOptions });
    reply({ token: 'session-token', user });
    const { signUp, useAuth } = await import('../auth');
    await expect(signUp(' ChessPlayer ')).resolves.toEqual(user);
    expect(mocks.registration).toHaveBeenCalledWith({ optionsJSON: registrationOptions });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ username: 'chessplayer' });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ challengeId: 'register-1', response: credential });
    expect(useAuth.getState()).toMatchObject({ token: 'session-token', user, status: 'signed-in' });
    expect(JSON.parse(storage.get('hindsight-auth')!).state).toEqual({ token: 'session-token', user, status: 'signed-in' });
    expect(mocks.connect).toHaveBeenCalledWith('chessplayer', undefined, 'Chess Player');
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it('maps HTTP 409 to exists', async () => {
    reply({ error: 'exists' }, 409);
    const { signUp, AuthError } = await import('../auth');
    const error = await signUp('chessplayer').catch(error => error);
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe('exists');
    expect(mocks.registration).not.toHaveBeenCalled();
  });

  it.each([false, true])('maps NotAllowedError cancellation (wrapped=%s)', async wrapped => {
    reply({ challengeId: 'register-1', options: registrationOptions });
    const cause = new DOMException('Dismissed', 'NotAllowedError');
    mocks.registration.mockRejectedValueOnce(wrapped ? new Error('WebAuthn failed', { cause }) : cause);
    const { signUp, useAuth } = await import('../auth');
    await expect(signUp('chessplayer')).rejects.toMatchObject({ code: 'cancelled' });
    expect(useAuth.getState().token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('signs in using a discoverable passkey and stores its token', async () => {
    reply({ challengeId: 'login-1', options: loginOptions });
    reply({ token: 'login-token', user });
    const { useAuth } = await import('../auth');
    await expect(useAuth.getState().signIn()).resolves.toEqual(user);
    expect(mocks.authentication).toHaveBeenCalledWith({ optionsJSON: loginOptions, useBrowserAutofill: false });
    expect(useAuth.getState().token).toBe('login-token');
  });

  it('keeps a successful sign-in when cloud sync fails', async () => {
    reply({ challengeId: 'login-1', options: loginOptions });
    reply({ token: 'login-token', user });
    mocks.start.mockRejectedValueOnce(new Error('Sync unavailable'));
    const { signIn, useAuth } = await import('../auth');
    await expect(signIn()).resolves.toEqual(user);
    expect(useAuth.getState().status).toBe('signed-in');
  });

  it('clears auth, disconnects and stops sync on sign-out', async () => {
    const { useAuth, signOut } = await import('../auth');
    useAuth.setState({ token: 'token', user, status: 'signed-in' });
    signOut();
    expect(useAuth.getState()).toMatchObject({ token: null, user: null, status: 'signed-out' });
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(mocks.stop).toHaveBeenCalledOnce());
  });

  it('rejects cloud auth when the backend is not configured', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const auth = await import('../auth');
    for (const attempt of [() => auth.signUp('player'), auth.signIn, () => auth.signInConditional(new AbortController().signal), auth.addPasskey, auth.listPasskeys, () => auth.removePasskey('id'), auth.passkeySupported]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'unsupported', message: expect.stringContaining('backend is not configured') });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cancels conditional UI using the supplied signal', async () => {
    reply({ challengeId: 'login-1', options: loginOptions });
    const controller = new AbortController();
    mocks.authentication.mockImplementationOnce(() => new Promise((_, reject) => {
      mocks.cancel.mockImplementationOnce(() => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const { signInConditional } = await import('../auth');
    const result = signInConditional(controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(mocks.authentication).toHaveBeenCalled());
    expect(mocks.authentication).toHaveBeenCalledWith({ optionsJSON: loginOptions, useBrowserAutofill: true });
    controller.abort();
    await assertion;
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });

  it('maps backend missing-credential and network failures', async () => {
    reply({ error: 'no_credential' }, 404);
    const { signIn } = await import('../auth');
    await expect(signIn()).rejects.toMatchObject({ code: 'no_credential' });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(signIn()).rejects.toMatchObject({ code: 'network' });
  });

  it('adds, lists and removes passkeys using authenticated routes', async () => {
    reply({ challengeId: 'add-1', options: registrationOptions });
    reply({ ok: true });
    const passkey = { id: 'key/1', device_name: 'Laptop', created_at: '2026-11-05', last_used_at: null };
    reply([passkey]);
    reply({ ok: true });
    const { useAuth, addPasskey, listPasskeys, removePasskey } = await import('../auth');
    useAuth.setState({ token: 'token', user, status: 'signed-in' });
    await addPasskey('Laptop');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ challengeId: 'add-1', response: credential, deviceName: 'Laptop' });
    await expect(listPasskeys()).resolves.toEqual([passkey]);
    await removePasskey('key/1');
    expect(fetchMock.mock.calls[3][0]).toBe('https://example.test/api/auth/passkeys/key%2F1');
    expect(fetchMock.mock.calls[3][1]).toMatchObject({ method: 'DELETE', headers: { Authorization: 'Bearer token' } });
  });

  it('does not mistake the last-passkey deletion conflict for an existing account', async () => {
    reply({ error: 'last_passkey' }, 409);
    const { removePasskey } = await import('../auth');
    await expect(removePasskey('key')).rejects.toMatchObject({ code: 'unknown', message: expect.stringContaining('Keep one passkey') });
  });
});

describe('api', () => {
  it('attaches the persisted bearer token and normalizes the URL', async () => {
    storage.set('hindsight-auth', JSON.stringify({ state: { token: 'saved-token', user, status: 'signed-in' }, version: 0 }));
    reply({ user });
    const { api } = await import('../api');
    await expect(api('/me')).resolves.toEqual({ user });
    expect(fetchMock).toHaveBeenCalledWith('https://example.test/api/me', expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer saved-token' }),
    }));
  });

  it('preserves API status and error code', async () => {
    reply({ error: 'last_passkey', message: 'Keep one passkey.' }, 400);
    const { api, ApiError } = await import('../api');
    const error = await api('/auth/passkeys/id', undefined, 'DELETE').catch(error => error);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'last_passkey', message: 'Keep one passkey.' });
  });
});

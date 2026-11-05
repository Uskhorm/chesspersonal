import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  startRegistration, startAuthentication, browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill, platformAuthenticatorIsAvailable, WebAuthnAbortService,
} from '@simplewebauthn/browser';
import { api, ApiError, cloudEnabled } from './api';
import { useStore } from './store';

export interface CloudUser {
  id: string;
  username: string;
  display_name: string | null;
  avatar: string | null;
}

export interface Passkey {
  id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
}

export type AuthErrorCode = 'cancelled' | 'not_found' | 'exists' | 'unsupported' | 'network' | 'no_credential' | 'unknown';
const messages: Record<AuthErrorCode, string> = {
  cancelled: 'Passkey cancelled. Try again when you’re ready.',
  not_found: 'That chess.com player was not found. Check the username.',
  exists: 'That player already has an account. Sign in with your passkey.',
  unsupported: 'Passkeys are not available in this browser. Try a supported browser.',
  network: 'Could not reach Hindsight. Check your connection and try again.',
  no_credential: 'No matching passkey was found. Try the device where you signed up.',
  unknown: 'Could not complete sign-in. Please try again.',
};

export class AuthError extends Error {
  constructor(public code: AuthErrorCode, message = messages[code]) {
    super(message);
    this.name = 'AuthError';
  }
}

function mapError(error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  if (error instanceof ApiError) {
    if (error.code === 'exists' || (error.status === 409 && error.code === 'unknown')) return new AuthError('exists');
    if (error.code === 'last_passkey') return new AuthError('unknown', 'Keep one passkey so you can sign in for your next game.');
    if (error.code === 'retry_login') return new AuthError('unknown', 'Please try signing in again.');
    if (error.code === 'not_found') return new AuthError('not_found');
    if (['no_credential', 'credential_not_found', 'passkey_not_found'].includes(error.code)) return new AuthError('no_credential');
    if (error.code === 'network' || error.status === 0) return new AuthError('network');
    return new AuthError('unknown');
  }
  const detail = error as { name?: string; code?: string; cause?: unknown } | null;
  if (detail?.cause && detail.cause !== error) return mapError(detail.cause);
  if (detail?.name === 'NotAllowedError' || detail?.name === 'AbortError' || detail?.code === 'ERROR_CEREMONY_ABORTED') return new AuthError('cancelled');
  if (detail?.name === 'InvalidStateError' || detail?.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return new AuthError('exists');
  if (detail?.name === 'NotFoundError') return new AuthError('no_credential');
  if (detail?.name === 'NotSupportedError' || detail?.name === 'SecurityError') return new AuthError('unsupported');
  return new AuthError('unknown');
}

function requireBackend() {
  if (!cloudEnabled) throw new AuthError('unsupported', 'The Hindsight backend is not configured. Set VITE_API_URL to enable sign-in.');
}

async function authAction<T>(action: () => Promise<T>): Promise<T> {
  requireBackend();
  try { return await action(); } catch (error) { throw mapError(error); }
}

function requireWebAuthn() {
  if (!browserSupportsWebAuthn()) throw new AuthError('unsupported');
}

export async function passkeySupported(): Promise<boolean> {
  requireBackend();
  try {
    return browserSupportsWebAuthn() && await platformAuthenticatorIsAvailable();
  } catch { return false; }
}

type Session = { token: string; user: CloudUser };
type RegistrationOptions = { challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] };
type LoginOptions = { challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] };

async function acceptSession(session: Session): Promise<CloudUser> {
  useAuth.setState({ ...session, status: 'signed-in' });
  useStore.getState().connect(session.user.username, session.user.avatar ?? undefined, session.user.display_name ?? undefined);
  try {
    // @ts-ignore M3 is implemented concurrently; cloud sync is optional at runtime.
    const cloudsync = await import('./cloudsync');
    if (useAuth.getState().token === session.token) await cloudsync.start();
  } catch { /* Local play remains available while cloud sync is unavailable. */ }
  return session.user;
}

export function signUp(username: string): Promise<CloudUser> {
  return authAction(async () => {
    requireWebAuthn();
    const { challengeId, options } = await api<RegistrationOptions>('/auth/register/options', { username: username.trim().toLowerCase() });
    const response = await startRegistration({ optionsJSON: options });
    return acceptSession(await api<Session>('/auth/register/verify', { challengeId, response }));
  });
}

async function login(useBrowserAutofill: boolean, signal?: AbortSignal): Promise<CloudUser> {
  return authAction(async () => {
    requireWebAuthn();
    const checkAbort = () => { if (signal?.aborted) throw new AuthError('cancelled'); };
    checkAbort();
    if (useBrowserAutofill && !await browserSupportsWebAuthnAutofill()) throw new AuthError('unsupported');
    const { challengeId, options } = await api<LoginOptions>('/auth/login/options', {});
    checkAbort();
    const abort = () => WebAuthnAbortService.cancelCeremony();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const response = await startAuthentication({ optionsJSON: options, useBrowserAutofill });
      checkAbort();
      const session = await api<Session>('/auth/login/verify', { challengeId, response });
      checkAbort();
      return await acceptSession(session);
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  });
}

export function signIn(): Promise<CloudUser> { return login(false); }
/** The sign-in input must include autocomplete="username webauthn" for browser autofill. */
export function signInConditional(signal: AbortSignal): Promise<CloudUser> { return login(true, signal); }

export function addPasskey(deviceName?: string): Promise<void> {
  return authAction(async () => {
    requireWebAuthn();
    const { challengeId, options } = await api<RegistrationOptions>('/auth/passkeys/options', {});
    const response = await startRegistration({ optionsJSON: options });
    await api('/auth/passkeys/verify', { challengeId, response, deviceName });
  });
}

export function listPasskeys(): Promise<Passkey[]> {
  return authAction(async () => {
    const result = await api<Passkey[] | { passkeys: Passkey[] }>('/auth/passkeys');
    return Array.isArray(result) ? result : result.passkeys;
  });
}

export function removePasskey(id: string): Promise<void> {
  return authAction(async () => { await api(`/auth/passkeys/${encodeURIComponent(id)}`, undefined, 'DELETE'); });
}

export function signOut(): void {
  useAuth.setState({ token: null, user: null, status: 'signed-out' });
  useStore.getState().disconnect();
  void (async () => {
    try {
      // @ts-ignore M3 is implemented concurrently; cloud sync is optional at runtime.
      const cloudsync = await import('./cloudsync');
      if (!useAuth.getState().token) await cloudsync.stop();
    } catch { /* Signing out also works without the sync module. */ }
  })();
}

export interface AuthState {
  token: string | null;
  user: CloudUser | null;
  status: 'signed-out' | 'signed-in';
  signUp: typeof signUp;
  signIn: typeof signIn;
  signInConditional: typeof signInConditional;
  addPasskey: typeof addPasskey;
  listPasskeys: typeof listPasskeys;
  removePasskey: typeof removePasskey;
  signOut: typeof signOut;
  passkeySupported: typeof passkeySupported;
}

export const useAuth = create<AuthState>()(persist((): AuthState => ({
  token: null, user: null, status: 'signed-out',
  signUp, signIn, signInConditional, addPasskey, listPasskeys, removePasskey, signOut, passkeySupported,
}), {
  name: 'hindsight-auth',
  storage: createJSONStorage(() => localStorage),
  partialize: ({ token, user, status }) => ({ token, user, status }),
}));

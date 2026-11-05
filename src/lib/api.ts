import { useAuth } from './auth';

export const API_URL = import.meta.env.VITE_API_URL as string | undefined;
export const cloudEnabled = !!API_URL;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  if (!cloudEnabled) throw new ApiError(0, 'unsupported', 'The Hindsight backend is not configured.');
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = useAuth.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response: Response;
  try {
    response = await fetch(`${API_URL!.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiError(0, 'network', 'Could not reach Hindsight. Check your connection and try again.');
  }
  if (response.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(response.status, 'unknown', 'Hindsight returned an unexpected response. Try again.');
  }
  if (response.status === 401 && token && useAuth.getState().token === token) {
    // The session was revoked or the account no longer exists: drop the token and stop syncing.
    // Local progress is kept; the user can sign in again from the gate or Profile.
    useAuth.setState({ token: null, user: null, status: 'signed-out' });
    void import('./cloudsync').then((m) => m.stop()).catch(() => {});
    void import('./bus').then(({ emit }) => emit({ type: 'toast', text: 'You were signed out. Sign in again to keep syncing.', tone: 'info' })).catch(() => {});
  }
  if (!response.ok) {
    const error = data as { error?: string; message?: string } | null;
    throw new ApiError(response.status, error?.error ?? 'unknown', error?.message ?? 'Hindsight could not complete that move. Try again.');
  }
  return data as T;
}

/**
 * Central API Client for SubGame Launcher (Django REST Framework Backend / PostgreSQL)
 */
export const BACKEND_API_URL =
  (import.meta as any).env?.VITE_BACKEND_API_URL || 'https://api.subgame.uz';

const API_ROOT = BACKEND_API_URL.replace(/\/+$/, '');

export function getAccessToken(): string | null {
  return localStorage.getItem('subgame_access_token');
}

export function setTokens(access: string, refresh?: string): void {
  localStorage.setItem('subgame_access_token', access);
  if (refresh) {
    localStorage.setItem('subgame_refresh_token', refresh);
  }
}

export function clearTokens(): void {
  localStorage.removeItem('subgame_access_token');
  localStorage.removeItem('subgame_refresh_token');
}

/**
 * Failed backend request. `status` is 0 when the server could not be reached at all.
 */
export class ApiError extends Error {
  status: number;
  data: any;

  constructor(status: number, message: string, data: any = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

async function refreshAccessToken(): Promise<boolean> {
  const refresh = localStorage.getItem('subgame_refresh_token');
  if (!refresh) return false;

  const res = await fetch(`${API_ROOT}/api/v1/auth/token/refresh/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  if (!res.ok) return false;

  const data = await res.json();
  if (!data.access) return false;
  setTokens(data.access, data.refresh);
  return true;
}

function send(url: string, options: RequestInit): Promise<Response> {
  const token = getAccessToken();
  return fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });
}

/**
 * Sends a request and throws ApiError on any failure, so callers can tell
 * "the server refused" apart from "the server is unreachable".
 */
export async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_ROOT}/${endpoint.replace(/^\/+/, '')}`;

  let res: Response;
  try {
    res = await send(url, options);
    if (res.status === 401 && (await refreshAccessToken())) {
      res = await send(url, options);
    }
  } catch {
    throw new ApiError(0, 'Serverga ulanib bo‘lmadi. Internet aloqangizni tekshiring.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(res.status, data?.error || 'Server xatolik qaytardi.', data);
  }
  return data as T;
}

/**
 * Read helper for data that has a sensible empty state: returns null instead of throwing.
 */
export async function fetchFromBackend<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  try {
    return await apiRequest<T>(endpoint, options);
  } catch {
    return null;
  }
}

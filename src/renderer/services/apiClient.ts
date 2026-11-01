/**
 * Central API Client for SubGame Launcher (Django REST Framework Backend / PostgreSQL)
 */
export const BACKEND_API_URL =
  (import.meta as any).env?.VITE_BACKEND_API_URL || 'https://api.subgame.uz';

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

export async function fetchFromBackend<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T | null> {
  try {
    const url = `${BACKEND_API_URL.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
    const token = getAccessToken();

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...((options.headers as Record<string, string>) || {}),
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (err) {
    // Backend offline / not reachable
    return null;
  }
}

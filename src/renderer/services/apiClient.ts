/**
 * Central API Client for SubGame Launcher (Django REST Framework Backend)
 */
export const BACKEND_API_URL = 'http://127.0.0.1:8000';

export async function fetchFromBackend<T = any>(endpoint: string, options: RequestInit = {}): Promise<T | null> {
  try {
    const url = `${BACKEND_API_URL.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`;
    const token = localStorage.getItem('subgame_access_token');

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers as Record<string, string> || {}),
    };

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      return null;
    }
    return await res.json();
  } catch (err) {
    // Backend offline
    return null;
  }
}

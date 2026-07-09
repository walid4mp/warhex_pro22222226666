const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4200';

export interface ApiOptions extends RequestInit {
  token?: string | null;
}

export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Request failed');
  }
  return response.json();
}

export { API_URL };

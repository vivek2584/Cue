const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

export class ApiError extends Error {
  public status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchWithAuth(endpoint: string, options: RequestInit = {}) {
  const token = localStorage.getItem('token');
  
  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = await response.json();
      message = data.error || message;
    } catch {}
    if (response.status === 401) {
      localStorage.removeItem('token');
      window.dispatchEvent(new Event('auth-error'));
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  get: (endpoint: string) => fetchWithAuth(endpoint),
  post: (endpoint: string, body: any) => fetchWithAuth(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  delete: (endpoint: string) => fetchWithAuth(endpoint, { method: 'DELETE' }),
};

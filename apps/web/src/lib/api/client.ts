import { PUBLIC_API_URL } from '$env/static/public';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string | null; serverFetch?: typeof fetch } = {},
): Promise<T> {
  const { token, serverFetch, ...rest } = options;
  const fetchFn = serverFetch ?? fetch;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(rest.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetchFn(`${PUBLIC_API_URL}${path}`, {
    ...rest,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    let body: { error?: { code?: string; message?: string } } = {};
    try {
      body = await res.json();
    } catch {
      // ignorar
    }
    throw new ApiError(res.status, body.error?.code ?? 'UNKNOWN', body.error?.message ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

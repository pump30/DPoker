import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  CreateInviteResponse,
  ErrorResponse,
} from '../../shared/api-types.js';

class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

async function request<T>(
  path: string,
  options: { method: string; body?: unknown; token?: string },
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(path, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    let code = 'unknown';
    try {
      const data = (await res.json()) as ErrorResponse;
      code = data.error;
    } catch {}
    throw new ApiError(res.status, code);
  }
  return (await res.json()) as T;
}

export const api = {
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body }),
  login: (body: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body }),
  createInvite: (token: string) =>
    request<CreateInviteResponse>('/api/invites', { method: 'POST', token }),
};

export { ApiError };

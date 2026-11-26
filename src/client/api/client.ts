import type {
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  CreateInviteResponse,
  ErrorResponse,
  TableListItem,
  TableResponse,
} from '../../shared/api-types.js';

class ApiError extends Error {
  constructor(public status: number, public code: string, public reason?: string) {
    super(reason ?? code);
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; signal?: AbortSignal },
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });
  if (!res.ok) {
    let code = 'unknown';
    let reason: string | undefined;
    try {
      const data = (await res.json()) as ErrorResponse;
      code = data.error;
      reason = data.reason;
    } catch {}
    throw new ApiError(res.status, code, reason);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  register: (body: RegisterRequest) =>
    request<AuthResponse>('/api/auth/register', { method: 'POST', body }),
  login: (body: LoginRequest) =>
    request<AuthResponse>('/api/auth/login', { method: 'POST', body }),
  createInvite: (token: string) =>
    request<CreateInviteResponse>('/api/invites', { method: 'POST', token }),
  listTables: (token: string) =>
    request<TableListItem[]>('/api/tables', { token }),
  getTable: (token: string, tableId: string, signal?: AbortSignal) =>
    request<TableResponse>(`/api/tables/${tableId}`, { token, signal }),
  createTable: (token: string, body: { name: string; smallBlind: number; bigBlind: number; minBuyIn: number; maxBuyIn: number; maxSeats: number; actionTimeoutSec?: number }) =>
    request<TableResponse>('/api/tables', { method: 'POST', token, body }),
  sit: (token: string, tableId: string, body: { seat: number; buyIn: number }) =>
    request<TableResponse>(`/api/tables/${tableId}/sit`, { method: 'POST', token, body }),
  leave: (token: string, tableId: string) =>
    request<TableResponse>(`/api/tables/${tableId}/leave`, { method: 'POST', token }),
  waitForAction: (token: string, tableId: string, signal?: AbortSignal) =>
    request<TableResponse | undefined>(`/api/tables/${tableId}/act?timeout=100`, { token, signal }),
  act: (token: string, tableId: string, body: { type: 'fold' | 'check' | 'call' | 'raise' | 'all-in'; amount?: number }) =>
    request<TableResponse>(`/api/tables/${tableId}/act`, { method: 'POST', token, body }),
};

export { ApiError };

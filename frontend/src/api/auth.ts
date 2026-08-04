const BASE = import.meta.env.VITE_API_BASE ?? ''

export interface AuthUser {
  id: string
  username: string
  createdAt: string
}

async function authRequest<T>(path: string, method: 'GET' | 'POST', body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    let message = text
    try { message = (JSON.parse(text) as { message?: string }).message ?? text } catch { /* plain text */ }
    throw new Error(message || `请求失败（${res.status}）`)
  }
  return res.json() as Promise<T>
}

export function apiAuthMe(): Promise<{ user: AuthUser }> {
  return authRequest('/api/auth/me', 'GET')
}

export function apiRegister(username: string, password: string): Promise<{ user: AuthUser }> {
  return authRequest('/api/auth/register', 'POST', { username, password })
}

export function apiLogin(username: string, password: string): Promise<{ user: AuthUser }> {
  return authRequest('/api/auth/login', 'POST', { username, password })
}

export function apiLogout(): Promise<{ ok: boolean }> {
  return authRequest('/api/auth/logout', 'POST')
}


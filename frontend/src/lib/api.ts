// Talks to the FastAPI backend. Same session token as the classic pages (docs/auth.js), so a
// sign-in carries over to docs/driver.html. The backend checks every role again.
import type { User } from './types'

declare global {
  interface Window { FLEET_API_URL?: string }
}

const params = new URLSearchParams(location.search)
export const API = (params.get('api') || window.FLEET_API_URL || '').replace(/\/$/, '')

function readStore(key: string) {
  try { return sessionStorage.getItem(key) || '' } catch { return '' }
}
function writeStore(key: string, value: string) {
  try { if (value) sessionStorage.setItem(key, value); else sessionStorage.removeItem(key) } catch { /* private mode */ }
}

let token = readStore('fmToken')
let demoKey = params.get('key') || readStore('fleetKey')
if (demoKey) writeStore('fleetKey', demoKey)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type Listener = () => void
const loginListeners = new Set<Listener>()
/** Called when the session expires so the app can show the sign-in screen again. */
export function onLoginRequired(fn: Listener) {
  loginListeners.add(fn)
  return () => { loginListeners.delete(fn) }
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body === undefined
    ? { headers: authHeaders() }
    : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Demo-Key': demoKey, ...authHeaders() },
        body: JSON.stringify(body) }
  const r = await fetch(API + path, init)
  const data = await r.json().catch(() => ({}))
  if (r.status === 401) {
    const err = (data as { error?: string }).error || ''
    if (err === 'login required') {
      setToken('')
      loginListeners.forEach(fn => fn())
    } else if (body !== undefined && err.includes('demo key')) {
      const k = window.prompt('This demo is locked for changes. Demo password:')
      if (k) { demoKey = k.trim(); writeStore('fleetKey', demoKey); return api<T>(path, body) }
    }
  }
  if (!r.ok) throw new ApiError(r.status, (data as { error?: string }).error || `Error ${r.status}`)
  return data as T
}

export function setToken(t: string) {
  token = t
  writeStore('fmToken', t)
}

/** The signed-in user (bearer token, or the HttpOnly cookie when the backend serves this page). */
export async function me(): Promise<User | null> {
  try {
    const r = await fetch(API + '/api/auth/me', { headers: authHeaders() })
    return r.ok ? (await r.json()).user : null
  } catch { return null }
}

export async function login(username: string, password: string): Promise<User> {
  const d = await api<{ token: string; user: User }>('/api/auth/login', { username, password })
  setToken(d.token)
  return d.user
}

export async function loginGuest(): Promise<User> {
  const d = await api<{ token: string; user: User }>('/api/auth/guest', {})
  setToken(d.token)
  return d.user
}

export async function logout() {
  try { await api('/api/auth/logout', {}) } catch { /* signed out locally anyway */ }
  setToken('')
}

export const tileUrl = (layer: string) => `${API}/api/map/tile/${layer}/{z}/{x}/{y}.png`

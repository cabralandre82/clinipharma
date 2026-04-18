/**
 * Client-side CSRF helper — Wave 6.
 *
 * Read-side companion to `lib/security/csrf.ts`. The server sets a
 * `__Host-csrf` cookie (in prod) or `csrf-token` (in dev) on every
 * safe navigation; this module makes it trivial for browser code to
 * echo that value back on mutating requests via the `X-CSRF-Token`
 * header, which is the final piece required to flip
 * `CSRF_ENFORCE_DOUBLE_SUBMIT=true` in production.
 *
 * Usage:
 *
 *   // Plain fetch:
 *   await fetchWithCsrf('/api/notifications/mark-read', {
 *     method: 'POST',
 *     body: JSON.stringify({ ids }),
 *   })
 *
 *   // React hook (for forms):
 *   const csrf = useCsrfToken()
 *   <input type="hidden" name="csrf_token" value={csrf ?? ''} />
 *
 * Server Actions in Next.js 15 already send the token via the built-in
 * Origin check mechanism; this module is for our own JSON `/api/**`
 * endpoints.
 *
 * @module lib/security/client-csrf
 */

'use client'

import { useEffect, useState } from 'react'

const COOKIE_NAMES = ['__Host-csrf', 'csrf-token'] as const
export const CSRF_HEADER = 'x-csrf-token'

/**
 * Read the CSRF cookie from `document.cookie`. Returns `null` when
 * running on the server (during SSR) or when the cookie is absent.
 *
 * The cookie is set by the middleware on the first GET navigation, so
 * any React client that renders after `getServerSideProps` / RSC will
 * have it available immediately.
 */
export function getCsrfCookie(): string | null {
  if (typeof document === 'undefined') return null
  const cookies = document.cookie.split('; ').filter(Boolean)
  for (const name of COOKIE_NAMES) {
    const match = cookies.find((c) => c.startsWith(`${name}=`))
    if (match) return decodeURIComponent(match.slice(name.length + 1))
  }
  return null
}

/**
 * React hook returning the current CSRF token. Re-reads after mount
 * (cookie arrives with the first response so hooks mounted before
 * navigation complete see null, hence the effect).
 */
export function useCsrfToken(): string | null {
  const [token, setToken] = useState<string | null>(() => getCsrfCookie())
  useEffect(() => {
    if (token) return
    const t = getCsrfCookie()
    if (t) setToken(t)
  }, [token])
  return token
}

/**
 * Drop-in replacement for `fetch` that auto-adds the `X-CSRF-Token`
 * header for mutating verbs. Non-mutating verbs (GET/HEAD/OPTIONS)
 * pass through unchanged to avoid flooding safe endpoints with
 * unnecessary headers.
 *
 * When the cookie is missing we still make the request — the server
 * will refuse with 403 if double-submit is enforced, and that failure
 * mode is exactly what we want surfaced to the caller.
 */
export async function fetchWithCsrf(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const method = (init.method ?? 'GET').toUpperCase()
  const unsafe = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE'
  if (!unsafe) return fetch(input, init)

  const headers = new Headers(init.headers)
  if (!headers.has(CSRF_HEADER)) {
    const token = getCsrfCookie()
    if (token) headers.set(CSRF_HEADER, token)
  }

  return fetch(input, {
    ...init,
    headers,
    // Always include cookies on same-origin so the server can read
    // the cookie for double-submit verification.
    credentials: init.credentials ?? 'same-origin',
  })
}

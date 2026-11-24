/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/**
 * Legacy-UI port of the rc51 bearer-token session.
 *
 * The rc51 backend authenticates regular business APIs ONLY via the
 * `Authorization: Bearer <token>` header. A refresh cookie mints a fresh
 * access token at `POST /api/user/auth/refresh`. This module keeps that
 * lifecycle in one place so the request/response interceptors and the login
 * flow all share the same token source.
 *
 * Kept deliberately small: no cross-tab sync, no bootstrap hints — the legacy
 * UI persists the bundle in localStorage and restores it on reload.
 */
import axios from 'axios'
import { t } from 'i18next'

import { useAuthStore, type AuthBundle } from '@/stores/auth-store'

export type RefreshOutcome =
  | { kind: 'authenticated'; bundle: AuthBundle }
  | { kind: 'anonymous' }
  | { kind: 'transient_error'; error: unknown }
  | { kind: 'out_of_sync'; code?: string }

interface RefreshHTTPResponse {
  status: number
  data?: unknown
  error?: unknown
}

interface TokenRotation {
  access_token: string
  token_type: string
  access_expires_at: number
  session: AuthBundle['session']
}

// Dedicated client: never routes through the api interceptors (avoids recursion).
const authClient = axios.create({
  baseURL: '',
  withCredentials: true,
  headers: {
    'Cache-Control': 'no-cache, no-store',
  },
})

// Coalesce concurrent 401s into a single refresh round trip.
let refreshPromise: Promise<RefreshOutcome> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function hasTokenFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.access_token === 'string' &&
    value.access_token.length > 0 &&
    typeof value.token_type === 'string' &&
    typeof value.access_expires_at === 'number' &&
    Number.isFinite(value.access_expires_at) &&
    value.access_expires_at > 0
  )
}

function isLoginSession(value: unknown): value is AuthBundle['session'] {
  return (
    isRecord(value) &&
    typeof value.sid === 'string' &&
    value.sid.length > 0
  )
}

/** Validate an rc51 login/refresh bundle before persisting it. */
export function isAuthBundle(value: unknown): value is AuthBundle {
  if (!isRecord(value)) return false
  return (
    hasTokenFields(value) &&
    isRecord(value.user) &&
    typeof value.user.id === 'number' &&
    isLoginSession(value.session)
  )
}

function isTokenRotation(value: unknown): value is TokenRotation {
  return (
    isRecord(value) &&
    hasTokenFields(value) &&
    isLoginSession(value.session)
  )
}

/** Persist a full auth bundle (user + token + session). */
export function applyAuthBundle(bundle: AuthBundle): void {
  useAuthStore.getState().auth.setBundle(bundle)
}

/** Clear every trace of the authenticated session. */
export function clearAuthentication(): void {
  useAuthStore.getState().auth.reset()
}

/** Current access token, if any. */
export function getAccessToken(): string | null {
  return useAuthStore.getState().auth.accessToken
}

async function requestRefresh(
  expectedSid?: string
): Promise<RefreshHTTPResponse> {
  try {
    const response = await authClient.post(
      '/api/user/auth/refresh',
      undefined,
      {
        headers: expectedSid ? { 'X-Auth-Session': expectedSid } : undefined,
      }
    )
    return { status: response.status, data: response.data }
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      return {
        status: error.response?.status ?? 0,
        data: error.response?.data,
        error,
      }
    }
    return { status: 0, error }
  }
}

async function runRefresh(): Promise<RefreshOutcome> {
  const expectedSid = useAuthStore.getState().auth.session?.sid
  const response = await requestRefresh(expectedSid)
  const responseData = isRecord(response.data) ? response.data : undefined
  const payload = isRecord(responseData?.data) ? responseData.data : undefined
  const code =
    typeof responseData?.code === 'string' ? responseData.code : undefined

  if (responseData?.success === true && payload) {
    if (isAuthBundle(payload)) {
      applyAuthBundle(payload)
      return { kind: 'authenticated', bundle: payload }
    }
    // Rotation responses carry fresh tokens + session but reuse the current user.
    const currentUser = useAuthStore.getState().auth.user
    if (currentUser && isTokenRotation(payload)) {
      const bundle: AuthBundle = {
        access_token: payload.access_token,
        token_type: payload.token_type,
        access_expires_at: payload.access_expires_at,
        user: currentUser,
        session: payload.session,
      }
      applyAuthBundle(bundle)
      return { kind: 'authenticated', bundle }
    }
  }

  if (response.status === 401) {
    clearAuthentication()
    return { kind: 'anonymous' }
  }

  if (response.status === 409) {
    clearAuthentication()
    return { kind: 'out_of_sync', code }
  }

  if (!response.status || response.status >= 500 || response.status === 429) {
    return {
      kind: 'transient_error',
      error: response.error ?? response.data,
    }
  }

  clearAuthentication()
  return {
    kind: 'out_of_sync',
    code: code ?? 'AUTH_INVALID_REFRESH_RESPONSE',
  }
}

/** Refresh the access token using the httpOnly refresh cookie. */
export function refreshAuthentication(): Promise<RefreshOutcome> {
  if (!refreshPromise) {
    refreshPromise = runRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const accessToken = getAccessToken()
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  return headers
}

/**
 * Headers with a token that is guaranteed fresh for ~60s.
 *
 * Used right before spending a one-time security proof: a proof token cannot
 * be replayed, so instead of retrying the 401 we refresh up front and send a
 * usable Authorization on the first attempt.
 */
export async function getFreshAuthHeaders(): Promise<Record<string, string>> {
  const auth = useAuthStore.getState().auth
  const refreshBefore = Math.floor(Date.now() / 1000) + 60
  if (
    auth.accessToken &&
    auth.accessExpiresAt &&
    auth.accessExpiresAt > refreshBefore
  ) {
    return authHeaders()
  }

  const outcome = await refreshAuthentication()
  if (outcome.kind === 'authenticated') {
    return authHeaders()
  }

  const current = useAuthStore.getState().auth
  if (
    current.accessToken &&
    current.accessExpiresAt &&
    current.accessExpiresAt > Math.floor(Date.now() / 1000)
  ) {
    return authHeaders()
  }

  if (outcome.kind === 'transient_error') {
    throw new Error(t('Request failed'), { cause: outcome.error })
  }
  throw new Error(t('Session expired!'))
}

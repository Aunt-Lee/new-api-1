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
import axios, { type AxiosRequestConfig } from 'axios'
import { t } from 'i18next'
import { toast } from 'sonner'

import {
  clearAuthentication,
  getAccessToken,
  getFreshAuthHeaders,
  refreshAuthentication,
} from '@/lib/auth-session'

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipBusinessError?: boolean
    skipErrorHandler?: boolean
    disableDuplicate?: boolean
    skipAuthRefresh?: boolean
    authRetry?: boolean
  }
}

export type ApiRequestConfig = AxiosRequestConfig

/**
 * Build an axios config that carries an rc51 one-time security proof.
 * Pass the returned config as the last argument of api.get/post/delete/etc.
 */
export function withProofHeader(
  proofToken: string | undefined,
  base: ApiRequestConfig = {}
): ApiRequestConfig {
  if (!proofToken) return base
  return {
    ...base,
    headers: {
      ...(base.headers as Record<string, string> | undefined),
      'X-Security-Proof': proofToken,
    },
  }
}

// ============================================================================
// Axios Instance Configuration
// ============================================================================

// Base URL: empty string for same-origin API requests
const baseURL = ''

// Create axios instance with default config
export const api = axios.create({
  baseURL,
  withCredentials: true, // Include cookies in cross-origin requests
  headers: {
    'Cache-Control': 'no-store', // Prevent caching
  },
})

// ============================================================================
// Request Deduplication
// ============================================================================

// Deduplicate concurrent GET requests to the same URL
// Prevents multiple identical requests from being sent simultaneously
const inFlightGet = new Map<string, Promise<unknown>>()
const originalGet = api.get.bind(api)

api.get = ((url: string, config: ApiRequestConfig = {}) => {
  const disableDuplicate = config.disableDuplicate
  if (disableDuplicate) return originalGet(url, config)

  const params = config.params ? JSON.stringify(config.params) : '{}'
  const key = `${url}?${params}`

  // Return existing in-flight request if available
  if (inFlightGet.has(key)) return inFlightGet.get(key)!

  // Create new request and clean up after completion
  const req = originalGet(url, config).finally(() => inFlightGet.delete(key))
  inFlightGet.set(key, req)
  return req
}) as typeof api.get

// ============================================================================
// Response Interceptor
// ============================================================================

// Handle business logic errors and HTTP errors globally
api.interceptors.response.use(
  (response) => {
    const skipBusiness = response.config.skipBusinessError

    // Unified business response format: { success, message, data }
    if (
      !skipBusiness &&
      response &&
      response.data &&
      typeof response.data.success === 'boolean'
    ) {
      if (!response.data.success) {
        // Show error toast for business failures
        const msg = response.data.message || t('Request failed')
        toast.error(msg)
      }
    }
    return response
  },
  async (error) => {
    const config = error?.config as ApiRequestConfig | undefined
    const skip = config?.skipErrorHandler
    const status = error?.response?.status

    if (status === 401) {
      if (config && !config.skipAuthRefresh && !config.authRetry) {
        // First 401: try to mint a fresh access token from the refresh cookie,
        // then replay the original request with the new Bearer token.
        config.authRetry = true
        const outcome = await refreshAuthentication()
        if (outcome.kind === 'authenticated') {
          const token = getAccessToken()
          if (token) {
            config.headers = {
              ...config.headers,
              Authorization: `Bearer ${token}`,
            }
          }
          return api.request(config)
        }
        clearAuthentication()
        if (!skip) {
          toast.error(t('Session expired!'))
        }
      } else if (config?.authRetry) {
        // Replay also failed: the session is genuinely unusable.
        clearAuthentication()
        if (!skip) {
          toast.error(t('Session expired!'))
        }
      } else if (!skip) {
        // skipAuthRefresh (one-time proof) — never clear the session or replay,
        // just surface the error so the caller can restart the proof flow.
        toast.error(t('Session expired!'))
      }
    } else if (!skip) {
      // Other errors: show error message from response or default
      const msg =
        error?.response?.data?.message || error?.message || t('Request failed')
      toast.error(msg)
    }
    return Promise.reject(error)
  }
)

// ============================================================================
// Common Headers Utility
// ============================================================================

/**
 * Get user ID from localStorage
 */
function getUserId(): string | null {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('uid')
    }
  } catch {
    /* empty */
  }
  return null
}

/**
 * Get common request headers (for both axios and SSE requests)
 */
export function getCommonHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const uid = getUserId()
  if (uid) {
    headers['New-Api-User'] = uid
  }

  // rc51 authenticates business APIs via Bearer token only.
  const accessToken = getAccessToken()
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }

  return headers
}

// ============================================================================
// Request Interceptor
// ============================================================================

/**
 * Read a header from an axios request config, tolerating both plain objects
 * and AxiosHeaders instances (which expose a `get` method).
 */
function readHeader(
  headers: ApiRequestConfig['headers'],
  name: string
): string | undefined {
  if (!headers) return undefined
  const bag = headers as Record<string, unknown> & {
    get?: (key: string) => unknown
  }
  const direct = bag[name] ?? bag[name.toLowerCase()]
  if (typeof direct === 'string' || typeof direct === 'number') {
    return String(direct)
  }
  const viaGet = bag.get?.(name)
  return typeof viaGet === 'string' ? viaGet : undefined
}

/** Attach the rc51 Bearer token (and legacy user header) to every request. */
api.interceptors.request.use(async (config) => {
  const uid = getUserId()
  if (uid) {
    // Custom header kept for backward compatibility with the legacy UI.
    ;(config.headers as Record<string, string>)['New-Api-User'] = uid
  }

  const hasProof = Boolean(
    readHeader(config.headers, 'X-Security-Proof')
  )
  if (hasProof) {
    // A one-time proof cannot be replayed after a 401. Refresh up front so the
    // first attempt carries a valid Bearer, and disable 401 replay below.
    config.skipAuthRefresh = true
    try {
      const headers = await getFreshAuthHeaders()
      for (const [name, value] of Object.entries(headers)) {
        ;(config.headers as Record<string, string>)[name] = value
      }
    } catch {
      // Keep the cached token (if any) and let the backend make the verdict.
      const accessToken = getAccessToken()
      if (accessToken) {
        ;(config.headers as Record<string, string>).Authorization =
          `Bearer ${accessToken}`
      }
    }
    return config
  }

  const accessToken = getAccessToken()
  if (accessToken) {
    ;(config.headers as Record<string, string>).Authorization =
      `Bearer ${accessToken}`
  }
  return config
})

// ============================================================================
// Common API Functions
// ============================================================================

// ----------------------------------------------------------------------------
// User APIs
// ----------------------------------------------------------------------------

// Get current user info
export async function getSelf() {
  const res = await api.get('/api/user/self', {
    // Avoid global 401 toast during guards/preloads
    skipErrorHandler: true,
  })
  return res.data
}

// Get user available models
export async function getUserModels(): Promise<{
  success: boolean
  message?: string
  data?: string[]
}> {
  const res = await api.get('/api/user/models')
  return res.data
}

// Get user groups with descriptions and ratios
export async function getUserGroups(): Promise<{
  success: boolean
  message?: string
  data?: Record<string, { desc: string; ratio: number | string }>
}> {
  const res = await api.get('/api/user/self/groups')
  return res.data
}

// ----------------------------------------------------------------------------
// System APIs
// ----------------------------------------------------------------------------

// Get system status
export async function getStatus() {
  const res = await api.get('/api/status')
  return res.data?.data as Record<string, unknown>
}

// Get system notice
export async function getNotice(): Promise<{
  success: boolean
  message?: string
  data?: string
}> {
  const res = await api.get('/api/notice')
  return res.data
}

// ----------------------------------------------------------------------------
// 2FA Management APIs
// ----------------------------------------------------------------------------

// Get 2FA status
export async function get2FAStatus() {
  const res = await api.get('/api/user/2fa/status')
  return res.data
}

/** Attach a one-time rc51 security proof to a protected request. */
export function securityProofHeaders(
  proofToken?: string
): Record<string, string> {
  return proofToken ? { 'X-Security-Proof': proofToken } : {}
}

// Setup 2FA (rc51 requires a `2fa.setup` proof)
export async function setup2FA(proofToken?: string) {
  const res = await api.post('/api/user/2fa/setup', undefined, {
    headers: securityProofHeaders(proofToken),
  })
  return res.data
}

// Enable 2FA with verification code (rc51 has no proof check on this endpoint)
export async function enable2FA(code: string) {
  const res = await api.post('/api/user/2fa/enable', { code })
  return res.data
}

// Disable 2FA with verification code (rc51 requires a `2fa.disable` proof)
export async function disable2FA(code: string, proofToken?: string) {
  const res = await api.post('/api/user/2fa/disable', { code }, {
    headers: securityProofHeaders(proofToken),
  })
  return res.data
}

// Regenerate 2FA backup codes (rc51 requires a `2fa.backup_codes.regenerate` proof)
export async function regenerate2FABackupCodes(code: string, proofToken?: string) {
  const res = await api.post('/api/user/2fa/backup_codes', { code }, {
    headers: securityProofHeaders(proofToken),
  })
  return res.data
}

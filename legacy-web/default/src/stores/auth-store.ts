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
import { create } from 'zustand'

import type { AdminCapabilities } from '@/lib/admin-permissions'

export type UserPermissions = {
  sidebar_settings?: boolean
  sidebar_modules?: Record<string, unknown>
  admin_permissions?: AdminCapabilities
}

export interface AuthUser {
  id: number
  username: string
  display_name?: string
  email?: string
  role: number
  status?: number
  group?: string
  quota?: number
  used_quota?: number
  request_count?: number
  aff_code?: string
  aff_count?: number
  aff_quota?: number
  aff_history_quota?: number
  inviter_id?: number
  github_id?: string
  oidc_id?: string
  wechat_id?: string
  telegram_id?: string
  linux_do_id?: string
  setting?: Record<string, unknown> | string
  stripe_customer?: string
  sidebar_modules?: string
  permissions?: UserPermissions
}

/** rc51 login session metadata returned by the auth bundle. */
export interface LoginSession {
  sid: string
  current: boolean
  login_method: string
  ip: string
  user_agent: string
  created_at: number
  last_active_at: number
  expires_at: number
}

/** rc51 login response `data` — the full authenticated bundle. */
export interface AuthBundle {
  access_token: string
  token_type: 'Bearer' | string
  access_expires_at: number
  user: AuthUser
  session: LoginSession
}

/** Persisted token state (user object is kept under the legacy `user` key). */
interface StoredSession {
  accessToken: string
  accessExpiresAt: number
  session: LoginSession
}

const USER_STORAGE_KEY = 'user'
const SESSION_STORAGE_KEY = 'auth_session'

/**
 * Restore the persisted access token/session from localStorage.
 * The legacy `user` object is restored separately to preserve old behaviour.
 */
function readStoredSession(): StoredSession | null {
  try {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem(SESSION_STORAGE_KEY)
      if (!saved) return null
      const parsed = JSON.parse(saved) as StoredSession
      if (
        parsed &&
        typeof parsed.accessToken === 'string' &&
        parsed.accessToken.length > 0 &&
        typeof parsed.accessExpiresAt === 'number' &&
        parsed.session &&
        typeof parsed.session.sid === 'string'
      ) {
        return parsed
      }
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch {
    // Clear dirty data when parsing fails
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  }
  return null
}

interface AuthState {
  auth: {
    user: AuthUser | null
    accessToken: string | null
    accessExpiresAt: number | null
    session: LoginSession | null
    setBundle: (bundle: AuthBundle) => void
    setUser: (user: AuthUser | null) => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => {
  // Restore user info from localStorage
  const initUser = (() => {
    try {
      if (typeof window !== 'undefined') {
        const saved = window.localStorage.getItem(USER_STORAGE_KEY)
        return saved ? JSON.parse(saved) : null
      }
    } catch {
      // Clear dirty data when parsing fails
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(USER_STORAGE_KEY)
      }
    }
    return null
  })()

  const initSession = readStoredSession()

  return {
    auth: {
      user: initUser,
      accessToken: initSession?.accessToken ?? null,
      accessExpiresAt: initSession?.accessExpiresAt ?? null,
      session: initSession?.session ?? null,
      // Persist the whole rc51 bundle (user + token + session) after login.
      setBundle: (bundle) =>
        set((state) => {
          if (typeof window !== 'undefined') {
            const stored: StoredSession = {
              accessToken: bundle.access_token,
              accessExpiresAt: bundle.access_expires_at,
              session: bundle.session,
            }
            window.localStorage.setItem(
              USER_STORAGE_KEY,
              JSON.stringify(bundle.user)
            )
            window.localStorage.setItem(
              SESSION_STORAGE_KEY,
              JSON.stringify(stored)
            )
          }
          return {
            ...state,
            auth: {
              ...state.auth,
              user: bundle.user,
              accessToken: bundle.access_token,
              accessExpiresAt: bundle.access_expires_at,
              session: bundle.session,
            },
          }
        }),
      setUser: (user) =>
        set((state) => {
          // Persist user to localStorage
          if (typeof window !== 'undefined') {
            if (user) {
              window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
            } else {
              window.localStorage.removeItem(USER_STORAGE_KEY)
            }
          }
          return { ...state, auth: { ...state.auth, user } }
        }),
      reset: () =>
        set((state) => {
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(USER_STORAGE_KEY)
            window.localStorage.removeItem(SESSION_STORAGE_KEY)
          }
          return {
            ...state,
            auth: {
              ...state.auth,
              user: null,
              accessToken: null,
              accessExpiresAt: null,
              session: null,
            },
          }
        }),
    },
  }
})

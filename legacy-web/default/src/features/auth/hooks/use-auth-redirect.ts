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
import { useNavigate } from '@tanstack/react-router'
import i18n from 'i18next'

import type { User } from '@/features/users/types'
import { normalizeInterfaceLanguage } from '@/i18n/languages'
import { applyAuthBundle, isAuthBundle } from '@/lib/auth-session'
import { getSelf } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { saveUserId } from '../lib/storage'

function getSavedLanguage(user: User): string | undefined {
  const userData = user as Record<string, unknown>
  if (typeof userData.language === 'string') {
    return userData.language
  }

  if (typeof userData.setting !== 'string') {
    return undefined
  }

  try {
    const setting = JSON.parse(userData.setting) as { language?: unknown }
    return typeof setting.language === 'string' ? setting.language : undefined
  } catch {
    return undefined
  }
}

function getLegacyUserId(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined
  const id = (value as { id?: unknown }).id
  return typeof id === 'number' ? id : undefined
}

/**
 * Hook for handling authentication redirects and user data management
 */
export function useAuthRedirect() {
  const navigate = useNavigate()
  const { auth } = useAuthStore()

  /**
   * Handle a successful login.
   *
   * rc51 returns a full auth bundle (`access_token`, `session`, `user`) from
   * every primary login transport. Persisting that bundle — BEFORE navigating
   * — is what makes the authenticated route guard see a user and lets the
   * follow-up `getSelf()` carry a Bearer token instead of failing with 401.
   *
   * The legacy `user`-only shape is still accepted as a fallback so older
   * callers (sign-up / wechat / passkey) keep working.
   *
   * @param userData - Login response data (bundle or legacy user object)
   * @param redirectTo - Redirect path after login
   */
  const handleLoginSuccess = async (
    userData?: unknown,
    redirectTo?: string
  ) => {
    if (isAuthBundle(userData)) {
      applyAuthBundle(userData)
      const savedLang = getSavedLanguage(userData.user as unknown as User)
      const normalizedLang = normalizeInterfaceLanguage(savedLang)
      if (normalizedLang && normalizedLang !== i18n.language) {
        i18n.changeLanguage(normalizedLang)
      }
    } else {
      // Legacy fallback: save id, then hydrate the user via getSelf()
      // (which now sends the Bearer token from the persisted session).
      const legacyId = getLegacyUserId(userData)
      if (legacyId) {
        saveUserId(legacyId)
      }

      try {
        const self = await getSelf()
        if (self?.success && self.data) {
          const user = self.data as User
          auth.setUser(user)

          if (user.id) {
            saveUserId(user.id)
          }

          const savedLang = getSavedLanguage(user)
          const normalizedLang = normalizeInterfaceLanguage(savedLang)
          if (normalizedLang && normalizedLang !== i18n.language) {
            i18n.changeLanguage(normalizedLang)
          }
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to fetch user data:', error)
      }
    }

    // Navigate to target page
    const targetPath = redirectTo || '/dashboard'
    navigate({ to: targetPath, replace: true })
  }

  /**
   * Redirect to 2FA page
   */
  const redirectTo2FA = () => {
    navigate({ to: '/otp', replace: true })
  }

  /**
   * Redirect to login page
   */
  const redirectToLogin = () => {
    navigate({ to: '/sign-in', replace: true })
  }

  /**
   * Redirect to register page
   */
  const redirectToRegister = () => {
    navigate({ to: '/sign-up', replace: true })
  }

  return {
    handleLoginSuccess,
    redirectTo2FA,
    redirectToLogin,
    redirectToRegister,
  }
}

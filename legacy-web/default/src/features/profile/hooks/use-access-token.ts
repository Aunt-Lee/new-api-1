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
import i18next from 'i18next'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'

import {
  ACCESS_TOKEN_GENERATE_CONTEXT,
  useRequestProof,
} from '@/features/auth/secure-verification'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

import { generateAccessToken } from '../api'

// ============================================================================
// Access Token Hook
// ============================================================================

export function useAccessToken() {
  const [token, setToken] = useState<string>('')
  const [generating, setGenerating] = useState(false)
  const { copyToClipboard } = useCopyToClipboard({ notify: false })
  const requestProof = useRequestProof()

  // Generate new access token.
  // The proof context must byte-for-byte match the backend compatibility
  // controller's fixed context (see ACCESS_TOKEN_GENERATE_CONTEXT).
  const generate = useCallback(async (): Promise<boolean> => {
    try {
      const proof = await requestProof({
        scope: 'access_token.generate',
        context: {
          scopes: [...ACCESS_TOKEN_GENERATE_CONTEXT.scopes],
          expires_at: ACCESS_TOKEN_GENERATE_CONTEXT.expires_at,
        },
      })
      if (!proof) return false
      setGenerating(true)
      const response = await generateAccessToken(proof.proof_token)

      if (response.success && response.data) {
        setToken(response.data)
        copyToClipboard(response.data)
        toast.success(i18next.t('Token regenerated and copied to clipboard'))
        return true
      }

      toast.error(response.message || i18next.t('Failed to generate token'))
      return false
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to generate token:', error)
      toast.error(i18next.t('Failed to generate token'))
      return false
    } finally {
      setGenerating(false)
    }
  }, [copyToClipboard, requestProof])

  return {
    token,
    generating,
    generate,
  }
}

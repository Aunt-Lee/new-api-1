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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import { checkVerificationMethods, verify } from '../api'
import type {
  RequestVerificationOptions,
  SecureVerificationState,
  SecurityProof,
  StartVerificationOptions,
  UseSecureVerificationOptions,
  VerificationMethod,
  VerificationMethods,
} from '../types'

/**
 * Business callback that receives the freshly issued proof. It must attach the
 * proof to the protected request (e.g. `X-Security-Proof` header).
 */
type ApiCall = ((proof: SecurityProof) => Promise<unknown>) | null

interface InternalState extends SecureVerificationState {
  apiCall: ApiCall
  /** Operation whose proof is being requested; bound into `/api/verify`. */
  operation: RequestVerificationOptions | null
}

const defaultMethods: VerificationMethods = {
  has2FA: false,
  hasPasskey: false,
  passkeySupported: false,
}

const initialState: InternalState = {
  method: null,
  loading: false,
  code: '',
  title: undefined,
  description: undefined,
  apiCall: null,
  operation: null,
}

export function useSecureVerification(
  options: UseSecureVerificationOptions = {}
) {
  const { onSuccess, onError, successMessage, autoReset = true } = options

  const [methods, setMethods] = useState<VerificationMethods>(defaultMethods)
  const [state, setState] = useState<InternalState>(initialState)
  const [open, setOpen] = useState(false)
  // Resolver for `requestVerification()`. The dialog stays mounted so the user
  // can retry a failed attempt; the promise settles only on success or cancel.
  const proofResolver = useRef<((proof: SecurityProof | null) => void) | null>(
    null
  )

  const settleProof = useCallback((proof: SecurityProof | null) => {
    const resolve = proofResolver.current
    proofResolver.current = null
    resolve?.(proof)
  }, [])

  const fetchVerificationMethods = useCallback(async () => {
    const result = await checkVerificationMethods()
    setMethods(result)
    return result
  }, [])

  useEffect(() => {
    fetchVerificationMethods()
  }, [fetchVerificationMethods])

  const reset = useCallback(() => {
    settleProof(null)
    setState(initialState)
    setOpen(false)
  }, [settleProof])

  const startVerification = useCallback(
    async (
      apiCall: (proof: SecurityProof) => Promise<unknown>,
      config: StartVerificationOptions = {}
    ) => {
      const { preferredMethod, title, description, operation } = config
      const availableMethods = await fetchVerificationMethods()

      if (!availableMethods.has2FA && !availableMethods.hasPasskey) {
        toast.error(
          i18next.t(
            'Please enable Two-factor Authentication or Passkey before proceeding'
          )
        )
        onError?.(
          new Error(
            'No verification methods available. Enable 2FA or Passkey to continue.'
          )
        )
        return false
      }

      let defaultMethod: VerificationMethod | null = preferredMethod ?? null
      if (!defaultMethod) {
        if (availableMethods.hasPasskey && availableMethods.passkeySupported) {
          defaultMethod = 'passkey'
        } else if (availableMethods.has2FA) {
          defaultMethod = '2fa'
        }
      }

      setState((prev) => ({
        ...prev,
        apiCall,
        operation: operation ?? null,
        method: defaultMethod,
        title,
        description,
      }))
      setOpen(true)
      return true
    },
    [fetchVerificationMethods, onError]
  )

  /**
   * Open the (unchanged) verification dialog for a specific rc51 operation and
   * resolve with the issued proof. Returns null when the user cancels or no
   * verification method is available.
   */
  const requestVerification = useCallback(
    async (
      operation: RequestVerificationOptions,
      preferredMethod?: VerificationMethod
    ): Promise<SecurityProof | null> => {
      if (proofResolver.current) return null
      return new Promise<SecurityProof | null>((resolve) => {
        proofResolver.current = resolve
        // apiCall returns the proof itself; the caller uses it after awaiting.
        void startVerification(async (proof) => proof, {
          title: operation.title,
          description: operation.description,
          operation,
          preferredMethod,
        }).then((started) => {
          if (!started) settleProof(null)
        })
      })
    },
    [startVerification, settleProof]
  )

  const executeVerification = useCallback(
    async (method?: VerificationMethod, code?: string) => {
      if (!state.apiCall) {
        toast.error(i18next.t('Verification is not configured properly'))
        return
      }
      if (!state.operation) {
        toast.error(i18next.t('Verification is not configured properly'))
        return
      }

      const actualMethod = method ?? state.method
      if (!actualMethod) {
        toast.error(i18next.t('Select a verification method first'))
        return
      }

      setState((prev) => ({ ...prev, loading: true }))

      try {
        // 1) Exchange the user's TOTP / passkey for a one-time rc51 proof.
        const proof = await verify(
          actualMethod,
          code ?? state.code,
          state.operation
        )
        // 2) Let the business call attach the proof and hit the protected API.
        const result = await state.apiCall(proof)

        settleProof(proof)

        if (successMessage) {
          toast.success(successMessage)
        }

        onSuccess?.(result, actualMethod)

        if (autoReset) {
          reset()
        }

        return result
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : i18next.t('Verification failed')
        toast.error(message)
        onError?.(error)
        throw error
      } finally {
        setState((prev) => ({ ...prev, loading: false }))
      }
    },
    [state, successMessage, onSuccess, onError, autoReset, reset, settleProof]
  )

  const setCode = useCallback((code: string) => {
    setState((prev) => ({ ...prev, code }))
  }, [])

  const switchMethod = useCallback((method: VerificationMethod) => {
    setState((prev) => ({ ...prev, method, code: '' }))
  }, [])

  const cancel = useCallback(() => {
    reset()
  }, [reset])

  const canUseMethod = useCallback(
    (method: VerificationMethod) => {
      if (method === '2fa') return methods.has2FA
      if (method === 'passkey') {
        return methods.hasPasskey && methods.passkeySupported
      }
      return false
    },
    [methods]
  )

  const recommendedMethod = useMemo<VerificationMethod | null>(() => {
    if (methods.hasPasskey && methods.passkeySupported) return 'passkey'
    if (methods.has2FA) return '2fa'
    return null
  }, [methods])

  return {
    open,
    setOpen,
    methods,
    state,
    startVerification,
    executeVerification,
    requestVerification,
    cancel,
    reset,
    setCode,
    switchMethod,
    fetchVerificationMethods,
    canUseMethod,
    recommendedMethod,
    hasAnyMethod: methods.has2FA || methods.hasPasskey,
    isLoading: state.loading,
    currentMethod: state.method,
    code: state.code,
  }
}

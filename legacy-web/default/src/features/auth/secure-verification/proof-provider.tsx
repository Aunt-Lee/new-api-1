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
 * Bridge between the legacy UI and rc51's one-time security proofs.
 *
 * A single instance of the ORIGINAL SecureVerificationDialog is rendered here
 * (the component itself is not modified). Any protected operation calls
 * `requestProof({ scope, context })` and receives a short-lived proof whose
 * token is attached to the business request as `X-Security-Proof`.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react'

import { SecureVerificationDialog } from './components/secure-verification-dialog'
import { useSecureVerification } from './hooks/use-secure-verification'
import type {
  RequestVerificationOptions,
  SecurityProof,
  VerificationMethod,
} from './types'

export type RequestProofOptions = RequestVerificationOptions & {
  /** Force a specific tab (used by Passkey-card which restricts to 2FA). */
  preferredMethod?: VerificationMethod
}

type RequestProof = (
  operation: RequestProofOptions
) => Promise<SecurityProof | null>

const RequestProofContext = createContext<RequestProof | null>(null)

export function SecureProofProvider({ children }: { children: ReactNode }) {
  const verification = useSecureVerification()

  const requestProof = useCallback<RequestProof>(
    (operation) =>
      verification.requestVerification(
        {
          scope: operation.scope,
          context: operation.context,
          title: operation.title,
          description: operation.description,
        } as RequestVerificationOptions,
        operation.preferredMethod
      ),
    [verification]
  )

  const value = useMemo(() => requestProof, [requestProof])

  return (
    <RequestProofContext.Provider value={value}>
      {children}
      <SecureVerificationDialog
        open={verification.open}
        onOpenChange={(open) => {
          if (!open) verification.cancel()
        }}
        methods={verification.methods}
        state={verification.state}
        onVerify={async (method, code) => {
          await verification.executeVerification(method, code)
        }}
        onCancel={verification.cancel}
        onCodeChange={verification.setCode}
        onMethodChange={verification.switchMethod}
      />
    </RequestProofContext.Provider>
  )
}

/**
 * Request an rc51 security proof. Returns null when the user cancels or no
 * verification method is available — callers should abort the operation.
 */
export function useRequestProof(): RequestProof {
  const ctx = useContext(RequestProofContext)
  if (!ctx) {
    throw new Error('useRequestProof must be used within <SecureProofProvider>')
  }
  return ctx
}

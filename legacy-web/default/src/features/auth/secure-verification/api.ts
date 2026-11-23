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
import { api, get2FAStatus } from '@/lib/api'
import {
  buildAssertionResult,
  prepareCredentialRequestOptions,
  isPasskeySupported as detectPasskeySupport,
} from '@/lib/passkey'

import { getPasskeyStatus } from '../passkey'
import type {
  SecurityProof,
  VerificationMethod,
  VerificationMethods,
  VerificationOperation,
} from './types'

/**
 * Fetch available verification methods for the current user.
 */
export async function checkVerificationMethods(): Promise<VerificationMethods> {
  try {
    const [twoFAResponse, passkeyResponse, passkeySupported] =
      await Promise.all([
        get2FAStatus(),
        getPasskeyStatus(),
        detectPasskeySupport(),
      ])

    const has2FA =
      Boolean(twoFAResponse?.success) && Boolean(twoFAResponse?.data?.enabled)
    const hasPasskey =
      Boolean(passkeyResponse?.success) &&
      Boolean(passkeyResponse?.data?.enabled)

    return {
      has2FA,
      hasPasskey,
      passkeySupported,
    }
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[Secure Verification] Failed to check methods', error)
    return {
      has2FA: false,
      hasPasskey: false,
      passkeySupported: false,
    }
  }
}

/**
 * Execute a verification flow and return the rc51 one-time security proof.
 * The proof is later attached to the business request via `X-Security-Proof`.
 */
export async function verify(
  method: VerificationMethod,
  code: string | undefined,
  operation: VerificationOperation
): Promise<SecurityProof> {
  switch (method) {
    case '2fa':
      return verifyTwoFA(code, operation)
    case 'passkey':
      return verifyPasskey(operation)
    default:
      throw new Error(`Unsupported verification method: ${method}`)
  }
}

/** Validate a `/api/verify` response shape and bind it to the operation. */
function assertProof(
  proof: SecurityProof | undefined,
  operation: VerificationOperation,
  method: VerificationMethod
): SecurityProof {
  if (
    !proof?.proof_token ||
    proof.scope !== operation.scope ||
    proof.method !== method ||
    proof.expires_at * 1000 <= Date.now()
  ) {
    throw new Error('Verification proof was not returned')
  }
  return proof
}

/** Perform 2FA verification (TOTP or backup code) via rc51 `/api/verify`. */
async function verifyTwoFA(
  code: string | undefined,
  operation: VerificationOperation
): Promise<SecurityProof> {
  const trimmed = code?.trim()
  if (!trimmed) {
    throw new Error('Please enter the verification code or backup code')
  }

  const res = await api.post('/api/verify', {
    method: '2fa',
    scope: operation.scope,
    ...(operation.context ? { context: operation.context } : {}),
    code: trimmed,
  })

  if (!res.data?.success) {
    throw new Error(res.data?.message || 'Verification failed')
  }

  return assertProof(res.data?.data as SecurityProof | undefined, operation, '2fa')
}

/**
 * Perform Passkey verification via rc51's interactive begin/finish flow.
 * rc51 rejects `/api/verify {method:'passkey'}` with FLOW_REQUIRED, so the
 * proof is produced by the finish endpoint itself.
 */
async function verifyPasskey(
  operation: VerificationOperation
): Promise<SecurityProof> {
  if (typeof navigator === 'undefined' || !navigator.credentials) {
    throw new Error('Passkey verification is not supported in this environment')
  }

  try {
    const beginResponse = await api.post('/api/user/passkey/verify/begin', {
      scope: operation.scope,
      ...(operation.context ? { context: operation.context } : {}),
    })

    if (!beginResponse.data?.success) {
      throw new Error(
        beginResponse.data?.message || 'Failed to start verification'
      )
    }

    const payload = beginResponse.data?.data
    if (!payload?.flow_token) {
      throw new Error('Verification flow expired')
    }

    const publicKey = prepareCredentialRequestOptions(
      payload.options ?? payload.publicKey ?? payload
    )

    const credential = (await navigator.credentials.get({
      publicKey,
    })) as PublicKeyCredential | null

    if (!credential) {
      throw new Error('Passkey verification was cancelled')
    }

    const assertion = buildAssertionResult(credential)
    if (!assertion) {
      throw new Error('Unable to build Passkey assertion')
    }

    const finishResponse = await api.post('/api/user/passkey/verify/finish', {
      flow_token: payload.flow_token,
      credential: assertion,
    })

    if (!finishResponse.data?.success) {
      throw new Error(
        finishResponse.data?.message || 'Passkey verification failed'
      )
    }

    return assertProof(
      finishResponse.data?.data as SecurityProof | undefined,
      operation,
      'passkey'
    )
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'NotAllowedError') {
      throw new Error('Passkey verification was cancelled or timed out', {
        cause: error,
      })
    }
    if (error instanceof DOMException && error.name === 'InvalidStateError') {
      throw new Error(
        'Passkey verification is not available in the current state',
        { cause: error }
      )
    }
    throw error
  }
}

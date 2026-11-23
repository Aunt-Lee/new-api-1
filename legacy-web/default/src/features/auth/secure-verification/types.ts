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
 * The legacy dialog only offers two verification tabs (Authenticator code /
 * Passkey), so the method union intentionally stays narrow. The rc51 backend
 * never returns another method for a proof obtained through this dialog.
 */
export type VerificationMethod = '2fa' | 'passkey'

export interface VerificationMethods {
  has2FA: boolean
  hasPasskey: boolean
  passkeySupported: boolean
}

export interface SecureVerificationState {
  method: VerificationMethod | null
  loading: boolean
  code: string
  title?: string
  description?: string
}

export interface UseSecureVerificationOptions {
  onSuccess?: (result: unknown, method: VerificationMethod) => void
  onError?: (error: unknown) => void
  successMessage?: string
  autoReset?: boolean
}

export interface StartVerificationOptions {
  preferredMethod?: VerificationMethod
  title?: string
  description?: string
  /**
   * rc51 operation the proof is bound to. Set internally by
   * `requestVerification`; direct `startVerification` callers may omit it.
   */
  operation?: RequestVerificationOptions
}

// ---------------------------------------------------------------------------
// rc51 proof contract
//
// These types mirror the backend scope catalog in
// service/security_verification.go. Keeping them in sync is mandatory: the
// backend derives an HMAC of a *normalized* context and rejects any proof whose
// scope/context does not match the protected endpoint.
// ---------------------------------------------------------------------------

/** Mirrors the 21 scopes declared by rc51's SecurityProofScope. */
export type SecurityProofScope =
  | 'channel.key.read'
  | 'passkey.register'
  | 'passkey.delete'
  | '2fa.setup'
  | '2fa.disable'
  | '2fa.backup_codes.regenerate'
  | 'access_token.generate'
  | 'access_token.update'
  | 'access_token.revoke'
  | 'account.binding.bind'
  | 'account.binding.unbind'
  | 'account.password.set'
  | 'account.password.change'
  | 'account.delete'
  | 'admin.user.create'
  | 'admin.user.update'
  | 'admin.user.delete'
  | 'admin.user.manage'
  | 'admin.user.passkey.reset'
  | 'admin.user.2fa.disable'
  | 'admin.user.binding.clear'

/** ManageUser actions that change a user's status or role and need step-up. */
export type AdminUserManageAction = 'disable' | 'enable' | 'promote' | 'demote'

/**
 * SHARED CONTRACT — access_token.generate context.
 * 前端申领 proof 与后端 controller/legacy_compat.go 的 LegacyAccessToken
 * 必须使用完全相同的 JSON 结构；字段/取值任一漂移都会导致 proof 校验失败。
 * {"scopes":["usage","token.read"],"expires_at":0}
 */
export const ACCESS_TOKEN_GENERATE_CONTEXT = {
  scopes: ['usage', 'token.read'],
  expires_at: 0,
} as const

export interface SecurityProof {
  proof_token: string
  expires_at: number
  method: VerificationMethod
  scope: SecurityProofScope
}

/** Every protected action with the strict, normalized context it requires. */
export type VerificationOperation =
  | { scope: 'channel.key.read'; context: { channel_id: number } }
  | {
      scope: 'account.binding.bind'
      context: { provider: string; email?: string; code?: string }
    }
  | { scope: 'account.binding.unbind'; context: { provider_id: number } }
  | { scope: 'admin.user.create'; context: { role: number } }
  | {
      scope:
        | 'admin.user.update'
        | 'admin.user.delete'
        | 'admin.user.passkey.reset'
        | 'admin.user.2fa.disable'
      context: { user_id: number }
    }
  | {
      scope: 'admin.user.manage'
      context: { user_id: number; action: AdminUserManageAction }
    }
  | {
      scope: 'admin.user.binding.clear'
      context:
        | { user_id: number; binding_type: string }
        | { user_id: number; provider_id: number }
    }
  | {
      scope: 'access_token.generate'
      context: { scopes: string[]; expires_at: number }
    }
  | {
      scope: Exclude<
        SecurityProofScope,
        | 'channel.key.read'
        | 'account.binding.bind'
        | 'account.binding.unbind'
        | 'access_token.generate'
        | 'access_token.update'
        | 'access_token.revoke'
        | 'account.delete'
        | `admin.user.${string}`
      >
      context?: Record<string, never>
    }
  | { scope: 'account.delete'; context?: Record<string, never> }

export type RequestVerificationOptions = VerificationOperation & {
  title?: string
  description?: string
}

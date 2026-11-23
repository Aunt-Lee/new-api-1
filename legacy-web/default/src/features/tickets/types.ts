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
 * Frontend-owned contract types for the ticket system (contract v3.1).
 *
 * These are intentionally declared locally: the frontend must not import Go
 * types, and must not rely on any server-side generated declaration.
 */

export type TicketStatus = 'pending' | 'processing' | 'resolved' | 'closed'

export type TicketKind = 'message' | 'event'

export type TicketActorRole = 'user' | 'admin' | 'system'

export type TicketNotifyTarget = 'user' | 'admin' | 'none'

export type TicketViewer = 'user' | 'admin'

export type TicketUnreadScope = 'self' | 'global'

export type TicketCloseAction = 'close' | 'reopen'

/** Uniform response envelope. `code` is only present on business failures. */
export interface ApiEnvelope<T = unknown> {
  success: boolean
  message?: string
  data?: T
  code?: string
}

/** U2 / A1 list payload: `data` IS the PageInfo object itself. */
export interface PageInfo<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface TicketSelfView {
  id: number
  title: string
  status: TicketStatus
  message_count: number
  last_message_id: number
  last_message_at: number
  created_at: number
  updated_at: number
}

/** A3 additionally carries the submitter and the admin-side watermark. */
export interface TicketAdminView extends TicketSelfView {
  user_id: number
  username: string
  last_admin_notify_id: number
  admin_last_read_id: number
}

export type AnyTicketView = TicketSelfView | TicketAdminView

/** Exactly the 12 fields of U4 / A3 `replies[]`. */
export interface MessageView {
  id: number
  ticket_id: number
  kind: TicketKind
  actor_role: TicketActorRole
  author_user_id: number
  author_username: string
  content: string
  event_type: string
  from_status: string
  to_status: string
  notify_target: TicketNotifyTarget
  created_at: number
}

/** U4 / A3 `data`. No pagination fields exist for the detail stream. */
export interface DetailData<T extends AnyTicketView = AnyTicketView> {
  ticket: T
  replies: MessageView[]
  total: number
  has_more: boolean
}

/** A1 `data` (PageInfo plus an optional search notice). */
export interface AdminListData extends PageInfo<TicketAdminView> {
  search_notice?: string
}

/** U1 */
export interface CreateView {
  id: number
  status?: TicketStatus
  message_count?: number
  last_message_id?: number
}

/** U5 / U6 / A4 / A5 */
export interface WriteResultView {
  changed: boolean
  status?: TicketStatus
  message_count?: number
  last_message_id?: number
}

/** U3 / A2 */
export interface UnreadCountData {
  count: number
  scope: TicketUnreadScope
}

/** U7 / A6 */
export interface ReadResultData {
  changed: boolean
  count: number
  last_read_id: number
  scope: TicketUnreadScope
}

export interface TicketListParams {
  p: number
  page_size: number
  status?: TicketStatus
}

export interface AdminListParams extends TicketListParams {
  keyword: string
}

export interface CreateTicketPayload {
  title: string
  content: string
}

export interface ReplyTicketPayload {
  content: string
  reopen?: boolean
}

export interface AdminReplyTicketPayload {
  content: string
  status?: TicketStatus
}

/** Value cached by the unread polling query. Never contains an AxiosError. */
export interface UnreadSnapshot {
  count: number
  /** Consecutive failed polls; drives 30 -> 60 -> 120s backoff. */
  failures: number
}

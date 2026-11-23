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
import type { TicketStatus } from './types'

/**
 * Build-time polling constant (contract v3.1, appendix A #8).
 * `go:embed` bundles front + back into one binary, so this is NOT runtime
 * configurable and no environment variable is introduced for it.
 *
 * It is shared by the unread badge query AND the detail stream query so the
 * detail page never creates a second, independent timer.
 */
export const TICKET_UNREAD_POLL_MS = 30_000

/** Backoff ladder on consecutive failures: 30s -> 60s -> 120s (capped). */
export const TICKET_UNREAD_BACKOFF_STEPS_MS = [
  TICKET_UNREAD_POLL_MS,
  TICKET_UNREAD_POLL_MS * 2,
  TICKET_UNREAD_POLL_MS * 4,
] as const

/** U4 / A3 stream is fixed at the most recent 200 entries, ascending. */
export const TICKET_DETAIL_STREAM_LIMIT = 200

/** Contract v3.1 length limits (appendix A #7). */
export const TICKET_TITLE_MAX_RUNES = 200
export const TICKET_CONTENT_MAX_RUNES = 8000
/** Go `len([]byte(s))` after decoding; implementation threshold <= 65535. */
export const TICKET_CONTENT_MAX_BYTES = 65535

/** `GetPageQuery` hard upper bound is 100 (§1.2). */
export const TICKET_LIST_PAGE_SIZE = 20

/** A1 `keyword` goes into the query string and therefore into [GIN] logs. */
export const TICKET_SEARCH_MAX_LENGTH = 64

export const TICKET_STATUSES: readonly TicketStatus[] = [
  'pending',
  'processing',
  'resolved',
  'closed',
] as const

/** Stable query-key roots, shared by sidebar, pages and detail panels. */
export const TICKET_QUERY_KEYS = {
  unread: ['ticket', 'unread'] as const,
  list: ['ticket', 'list'] as const,
  adminList: ['ticket', 'admin-list'] as const,
  detail: ['ticket', 'detail'] as const,
} as const

/**
 * Machine error code -> dotless English phrase i18n key.
 *
 * `i18n/config.ts` only sets `nsSeparator: false`; `keySeparator` is still the
 * default `'.'`. Passing `ticket.title_empty` straight to `t()` would be
 * parsed as a nested path and echo the raw key back to the user. All keys here
 * are deliberately free of dots.
 *
 * The mapping is only a FALLBACK: user-visible errors prefer the backend
 * `message` (already localized server-side). See `resolveTicketErrorMessage`.
 */
export const TICKET_ERROR_KEY: Readonly<Record<string, string>> = {
  'ticket.invalid_params': 'Ticket Error Invalid Params',
  'ticket.title_empty': 'Ticket Error Title Empty',
  'ticket.title_too_long': 'Ticket Error Title Too Long',
  'ticket.content_empty': 'Ticket Error Content Empty',
  'ticket.content_too_long': 'Ticket Error Content Too Long',
  'ticket.not_found': 'Ticket Error Not Found',
  'ticket.status_not_replyable': 'Ticket Error Status Not Replyable',
  'ticket.invalid_transition': 'Ticket Error Invalid Transition',
  'ticket.duplicate': 'Ticket Error Duplicate',
  'ticket.rate_limited': 'Ticket Error Rate Limited',
  'ticket.db_error': 'Ticket Error Db Error',
}

/** Status label keys are prefixed: bare `'Pending'` is already taken (§1.3 F3). */
export const TICKET_STATUS_KEY: Readonly<Record<TicketStatus, string>> = {
  pending: 'Ticket Pending',
  processing: 'Ticket Processing',
  resolved: 'Ticket Resolved',
  closed: 'Ticket Closed',
}

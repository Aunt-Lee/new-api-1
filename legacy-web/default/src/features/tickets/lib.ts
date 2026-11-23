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
import {
  TICKET_CONTENT_MAX_BYTES,
  TICKET_CONTENT_MAX_RUNES,
  TICKET_STATUS_KEY,
  TICKET_TITLE_MAX_RUNES,
} from './constants'
import type {
  MessageView,
  TicketStatus,
  TicketViewer,
} from './types'

export function isTicketStatus(value: string): value is TicketStatus {
  return (
    value === 'pending' ||
    value === 'processing' ||
    value === 'resolved' ||
    value === 'closed'
  )
}

/** Always returns a dotless, prefixed i18n key (§1.3 F3). */
export function ticketStatusKey(status: string): string {
  return isTicketStatus(status)
    ? TICKET_STATUS_KEY[status]
    : 'Ticket Status Unknown'
}

/** Rune count via code points. JS `String.length` counts UTF-16 units and is banned. */
export function countRunes(value: string): number {
  return [...value].length
}

/** UTF-8 byte length of the decoded string, matching Go `len([]byte(s))`. */
export function countUtf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

/**
 * Local validation returns an i18n key (never a raw `ticket.xxx` code).
 * `trim()` is used only for the emptiness check; the stored value is never
 * rewritten, matching the backend `TrimSpace` semantics (§7.4).
 */
export function validateTicketTitle(value: string): string | null {
  if (value.trim() === '') return 'Ticket Validation Title Empty'
  if (countRunes(value) > TICKET_TITLE_MAX_RUNES) {
    return 'Ticket Validation Title Too Long'
  }
  return null
}

export function validateTicketContent(value: string): string | null {
  if (value.trim() === '') return 'Ticket Validation Content Empty'
  // "whichever comes first": both conditions are evaluated, either one rejects.
  if (
    countRunes(value) > TICKET_CONTENT_MAX_RUNES ||
    countUtf8Bytes(value) > TICKET_CONTENT_MAX_BYTES
  ) {
    return 'Ticket Validation Content Too Long'
  }
  return null
}

export function isTicketReplyable(status: TicketStatus): boolean {
  return status !== 'closed'
}

export function countReplies(replies: readonly MessageView[]): number {
  let total = 0
  for (const item of replies) {
    if (item.kind === 'message') total += 1
  }
  return total
}

/** Own side = the side currently viewing the conversation. */
export function isOwnMessage(message: MessageView, viewer: TicketViewer): boolean {
  return viewer === 'user'
    ? message.actor_role === 'user'
    : message.actor_role === 'admin'
}

export interface TicketEventDescriptor {
  /** Parameterized i18n key; values live in en.json / zh.json. */
  key: string
  fromKey: string
  toKey: string
  /** Generic, localized role word only. Never an account or username snapshot. */
  actorKey: string | null
}

/**
 * Build a purely system-authored description of an `kind='event'` row.
 *
 * Only `event_type` / `from_status` / `to_status` are consulted. `content`,
 * `author_username`, `author_user_id` and every other identity field are
 * deliberately ignored, so no user input and no admin account can leak into
 * the system prompt bar (§5.3 / §8.2 / appendix A #9).
 */
export function describeTicketEvent(
  message: MessageView,
  viewer: TicketViewer
): TicketEventDescriptor {
  const fromKey = ticketStatusKey(message.from_status)
  const toKey = ticketStatusKey(message.to_status)

  // Only name the *generic* counterpart role, and only when the event was
  // triggered by the other side. Events triggered by the viewer's own side
  // render without any actor at all.
  let actorKey: string | null = null
  if (message.actor_role === 'admin' && viewer === 'user') {
    actorKey = 'Ticket Event Actor Admin'
  } else if (message.actor_role === 'user' && viewer === 'admin') {
    actorKey = 'Ticket Event Actor User'
  }

  const hasStructuredStatus =
    Boolean(message.from_status) || Boolean(message.to_status)

  let key = 'Ticket Event Generic'
  if (message.event_type === 'status_changed' && hasStructuredStatus) {
    key = actorKey
      ? 'Ticket Event Status Changed By'
      : 'Ticket Event Status Changed'
  }

  return { key, fromKey, toKey, actorKey }
}

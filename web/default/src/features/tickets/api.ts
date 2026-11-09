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
import { t } from 'i18next'

import { api } from '@/lib/api'

import { TICKET_ERROR_KEY } from './constants'
import type {
  AdminListData,
  AdminListParams,
  AdminReplyTicketPayload,
  ApiEnvelope,
  CreateTicketPayload,
  CreateView,
  DetailData,
  PageInfo,
  ReadResultData,
  ReplyTicketPayload,
  TicketAdminView,
  TicketCloseAction,
  TicketListParams,
  TicketSelfView,
  TicketStatus,
  UnreadCountData,
  WriteResultView,
} from './types'

/**
 * Domain-level error. Deliberately NOT an `AxiosError`: `main.tsx` installs a
 * global `queryCache.onError` that navigates the whole site to `/500` for
 * AxiosErrors with HTTP 500. Ticket failures are converted into this plain
 * Error so a backend 5xx can never redirect the app.
 */
export class TicketApiError extends Error {
  readonly code?: string
  readonly status?: number

  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.name = 'TicketApiError'
    this.code = code
    this.status = status
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function readCode(body: ApiEnvelope<unknown> | undefined): string | undefined {
  return typeof body?.code === 'string' ? body.code : undefined
}

function translate(key: string): string {
  return String(t(key))
}

/**
 * Resolve a user-visible error message.
 *
 * Priority: backend `message` (already localized) > `code -> dotless key`
 * fallback mapping > HTTP 429 hint > generic hint. A backend `message` that
 * looks like an untranslated machine key (e.g. `ticket.title_empty`) is NOT
 * shown, so raw dotted keys can never leak to the UI (§1.3 F2).
 */
export function resolveTicketErrorMessage(
  payload: unknown,
  status?: number
): string {
  const body = asRecord(payload)
  const message = typeof body?.message === 'string' ? body.message.trim() : ''
  const looksLikeRawKey =
    message !== '' && /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(message)

  if (message !== '' && !looksLikeRawKey) return message

  const code = typeof body?.code === 'string' ? body.code : ''
  const fallbackKey = code ? TICKET_ERROR_KEY[code] : undefined
  if (fallbackKey) return translate(fallbackKey)
  if (status === 429) return translate('Ticket Error Rate Limited')
  return translate('Ticket Error Generic')
}

/**
 * All ticket requests opt out of the two global toast handlers in `lib/api.ts`
 * and resolve their own localized messages. The 401 branch of the global
 * interceptor still resets the auth store regardless of `skipErrorHandler`.
 */
const TICKET_CONFIG = {
  skipBusinessError: true,
  skipErrorHandler: true,
} as const

interface RawEnvelope<T> {
  data: ApiEnvelope<T>
  status?: number
}

async function request<T>(call: () => Promise<RawEnvelope<T>>): Promise<T> {
  let body: ApiEnvelope<T> | undefined
  let status: number | undefined

  try {
    const response = await call()
    body = response?.data
    status = response?.status
  } catch (error) {
    const err = asRecord(error)
    const response = asRecord(err?.response)
    status = typeof response?.status === 'number' ? response.status : undefined
    body = response?.data as ApiEnvelope<T> | undefined
    throw new TicketApiError(
      resolveTicketErrorMessage(body, status),
      readCode(body),
      status
    )
  }

  if (!body || body.success !== true) {
    throw new TicketApiError(
      resolveTicketErrorMessage(body, status),
      readCode(body),
      status
    )
  }

  // On a not-found / unauthorized response the backend returns an entirely
  // empty `data` (not even `total:0` / `has_more:false`). Surface it as a
  // localized "not found" instead of handing `undefined` to the UI.
  if (body.data === undefined || body.data === null) {
    throw new TicketApiError(
      resolveTicketErrorMessage({ code: 'ticket.not_found' }, status),
      'ticket.not_found',
      status
    )
  }

  return body.data
}

// ---------------------------------------------------------------------------
// User group: /api/ticket/  (trailing slash; §14.1 #5)
// ---------------------------------------------------------------------------

/** U1 */
export function createTicket(payload: CreateTicketPayload): Promise<CreateView> {
  return request<CreateView>(() =>
    api.post('/api/ticket/', payload, TICKET_CONFIG)
  )
}

/** U2 */
export function getTickets(
  params: TicketListParams
): Promise<PageInfo<TicketSelfView>> {
  return request<PageInfo<TicketSelfView>>(() =>
    api.get('/api/ticket/', {
      ...TICKET_CONFIG,
      params: {
        p: params.p,
        page_size: params.page_size,
        ...(params.status ? { status: params.status } : {}),
      },
    })
  )
}

/** U3 */
export function getSelfUnreadCount(): Promise<UnreadCountData> {
  return request<UnreadCountData>(() =>
    api.get('/api/ticket/unread-count', TICKET_CONFIG)
  )
}

/** U4 */
export function getTicketDetail(
  id: number
): Promise<DetailData<TicketSelfView>> {
  return request<DetailData<TicketSelfView>>(() =>
    api.get(`/api/ticket/item/${id}`, TICKET_CONFIG)
  )
}

/** U5 */
export function replyToTicket(
  id: number,
  payload: ReplyTicketPayload
): Promise<WriteResultView> {
  return request<WriteResultView>(() =>
    api.post(`/api/ticket/item/${id}/reply`, payload, TICKET_CONFIG)
  )
}

/** U6 */
export function changeTicketStatusByUser(
  id: number,
  action: TicketCloseAction
): Promise<WriteResultView> {
  return request<WriteResultView>(() =>
    api.put(`/api/ticket/item/${id}/status`, { action }, TICKET_CONFIG)
  )
}

/** U7 */
export function markTicketRead(id: number): Promise<ReadResultData> {
  return request<ReadResultData>(() =>
    api.post(`/api/ticket/item/${id}/read`, undefined, TICKET_CONFIG)
  )
}

// ---------------------------------------------------------------------------
// Admin group: /api/ticket/admin/
// ---------------------------------------------------------------------------

/** A1 */
export function getAdminTickets(
  params: AdminListParams
): Promise<AdminListData> {
  return request<AdminListData>(() =>
    api.get('/api/ticket/admin/', {
      ...TICKET_CONFIG,
      params: {
        p: params.p,
        page_size: params.page_size,
        keyword: params.keyword,
        ...(params.status ? { status: params.status } : {}),
      },
    })
  )
}

/** A2 */
export function getAdminUnreadCount(): Promise<UnreadCountData> {
  return request<UnreadCountData>(() =>
    api.get('/api/ticket/admin/unread-count', TICKET_CONFIG)
  )
}

/** A3 */
export function getAdminTicketDetail(
  id: number
): Promise<DetailData<TicketAdminView>> {
  return request<DetailData<TicketAdminView>>(() =>
    api.get(`/api/ticket/admin/item/${id}`, TICKET_CONFIG)
  )
}

/** A4 */
export function adminReplyToTicket(
  id: number,
  payload: AdminReplyTicketPayload
): Promise<WriteResultView> {
  return request<WriteResultView>(() =>
    api.post(`/api/ticket/admin/item/${id}/reply`, payload, TICKET_CONFIG)
  )
}

/** A5 */
export function adminChangeTicketStatus(
  id: number,
  status: TicketStatus
): Promise<WriteResultView> {
  return request<WriteResultView>(() =>
    api.put(`/api/ticket/admin/item/${id}/status`, { status }, TICKET_CONFIG)
  )
}

/** A6 */
export function adminMarkTicketRead(id: number): Promise<ReadResultData> {
  return request<ReadResultData>(() =>
    api.post(`/api/ticket/admin/item/${id}/read`, undefined, TICKET_CONFIG)
  )
}

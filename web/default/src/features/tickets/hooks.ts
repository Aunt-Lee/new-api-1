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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import {
  TICKET_QUERY_KEYS,
  TICKET_UNREAD_BACKOFF_STEPS_MS,
  TICKET_UNREAD_POLL_MS,
} from './constants'
import { getAdminUnreadCount, getSelfUnreadCount } from './api'
import type { TicketUnreadScope, UnreadCountData, UnreadSnapshot } from './types'

export function ticketUnreadQueryKey(scope: TicketUnreadScope) {
  return [...TICKET_QUERY_KEYS.unread, scope] as const
}

/**
 * Last successfully observed badge per scope, kept outside React so it
 * survives remounts (sidebar / command menu / pages all share one query key).
 * On failure the badge is never cleared and never flickers.
 */
const lastSuccessfulCount: Record<TicketUnreadScope, number> = {
  self: 0,
  global: 0,
}

function normalizeCount(data: UnreadCountData | undefined, scope: TicketUnreadScope) {
  if (data && typeof data.count === 'number' && Number.isFinite(data.count)) {
    return Math.max(0, Math.trunc(data.count))
  }
  return lastSuccessfulCount[scope]
}

/**
 * Single unread-badge polling query for the whole application.
 *
 * F4 (§1.3): `main.tsx` sets `refetchOnWindowFocus:false` / `staleTime:10s`
 * and its `queryCache.onError` navigates to `/500` for axios HTTP 500.
 * Therefore this hook:
 *   - explicitly overrides every polling / visibility / staleness option,
 *   - NEVER lets an error escape `queryFn` (it returns the last good badge),
 *   - pauses the interval while the page is hidden,
 *   - refetches immediately when the page becomes visible again,
 *   - backs off 30 -> 60 -> 120s (capped) on consecutive failures.
 *
 * The detail panel reuses the SAME `TICKET_UNREAD_POLL_MS` constant for its
 * own `refetchInterval`; no second hand-rolled timer is introduced.
 */
export function useTicketUnread(
  scope: TicketUnreadScope,
  enabled = true
): number {
  const queryClient = useQueryClient()
  const queryKey = ticketUnreadQueryKey(scope)

  const query = useQuery<UnreadSnapshot>({
    queryKey,
    enabled,
    queryFn: async () => {
      const previous = queryClient.getQueryData<UnreadSnapshot>(queryKey)
      try {
        const data =
          scope === 'self' ? await getSelfUnreadCount() : await getAdminUnreadCount()
        const count = normalizeCount(data, scope)
        lastSuccessfulCount[scope] = count
        return { count, failures: 0 }
      } catch {
        // Swallow everything, including AxiosError. A backend 5xx must never
        // reach the global queryCache.onError (which would navigate to /500).
        const failures = Math.min(
          (previous?.failures ?? 0) + 1,
          TICKET_UNREAD_BACKOFF_STEPS_MS.length
        )
        return { count: lastSuccessfulCount[scope], failures }
      }
    },
    refetchInterval: (q) => {
      const failures = q.state.data?.failures ?? 0
      const index = Math.min(failures, TICKET_UNREAD_BACKOFF_STEPS_MS.length - 1)
      return TICKET_UNREAD_BACKOFF_STEPS_MS[index]
    },
    // Explicit overrides of the global QueryClient defaults (F4).
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    retry: false,
    gcTime: Infinity,
  })

  return query.data?.count ?? 0
}

/** Write the badge returned by U7 / A6 into the shared cache (no extra request). */
export function useApplyUnreadCount() {
  const queryClient = useQueryClient()
  return useCallback(
    (scope: TicketUnreadScope, count: number) => {
      const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
      lastSuccessfulCount[scope] = safe
      queryClient.setQueryData<UnreadSnapshot>(ticketUnreadQueryKey(scope), {
        count: safe,
        failures: 0,
      })
    },
    [queryClient]
  )
}

export { TICKET_UNREAD_POLL_MS }

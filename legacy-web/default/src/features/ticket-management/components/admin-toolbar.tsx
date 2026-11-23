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
import { useEffect, useState } from 'react'

import { useDebounce } from '@/hooks'
import { TicketToolbar } from '@/features/tickets/components/ticket-toolbar'

/**
 * Admin list toolbar.
 *
 * A1 takes `keyword` in the query string, and `gin/logger.go` appends the raw
 * query to `[GIN]` access logs. The input is therefore debounced (to avoid
 * firing a request per keystroke), length-capped by the shared toolbar, and
 * always accompanied by the search-scope / do-not-paste-secrets hint.
 */
export function AdminTicketToolbar({
  status,
  onStatusChange,
  onKeywordChange,
  onRefresh,
  refreshing,
  notice,
}: {
  status: string
  onStatusChange: (value: string) => void
  onKeywordChange: (value: string) => void
  onRefresh: () => void
  refreshing?: boolean
  notice?: string
}) {
  const [input, setInput] = useState('')
  const debouncedKeyword = useDebounce(input.trim(), 400)

  useEffect(() => {
    onKeywordChange(debouncedKeyword)
    // `onKeywordChange` is kept out of deps: it is stable at the call site and
    // re-running on every parent render would re-trigger the list query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKeyword])

  return (
    <TicketToolbar
      status={status}
      onStatusChange={onStatusChange}
      keyword={input}
      onKeywordChange={setInput}
      onRefresh={onRefresh}
      refreshing={refreshing}
      notice={notice}
    />
  )
}

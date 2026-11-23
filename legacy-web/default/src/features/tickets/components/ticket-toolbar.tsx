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
import { RefreshCw, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

import { TICKET_SEARCH_MAX_LENGTH } from '../constants'
import { TicketStatusSelect } from './common'

/**
 * Shared list toolbar. `keyword` is only supplied by the admin page; A1 puts
 * it in the query string, which lands in the [GIN] access log, so the input is
 * length-capped and accompanied by an explicit scope/safety hint (§9).
 */
export function TicketToolbar({
  status,
  onStatusChange,
  keyword,
  onKeywordChange,
  onRefresh,
  refreshing = false,
  notice,
  extra,
}: {
  status: string
  onStatusChange: (value: string) => void
  keyword?: string
  onKeywordChange?: (value: string) => void
  onRefresh: () => void
  refreshing?: boolean
  notice?: string
  extra?: ReactNode
}) {
  const { t } = useTranslation()
  const searchable = keyword !== undefined && onKeywordChange !== undefined

  return (
    <div className='shrink-0 space-y-2 border-b px-1 pb-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <TicketStatusSelect
          value={status}
          onValueChange={onStatusChange}
          includeAll
          ariaLabel={t('Status')}
        />
        {searchable ? (
          <div className='relative min-w-40 flex-1'>
            <Search className='text-muted-foreground pointer-events-none absolute top-1/2 start-2 size-3.5 -translate-y-1/2' />
            <Input
              className='ps-7'
              value={keyword}
              onChange={(event) => {
                // Rune-based cap (not UTF-16 `String.length`): keeps a search
                // term short so a full title / message body cannot be pasted
                // into the query string that [GIN] logs in plaintext.
                const next = [...event.target.value]
                  .slice(0, TICKET_SEARCH_MAX_LENGTH)
                  .join('')
                onKeywordChange?.(next)
              }}
              placeholder={t('Ticket Search Placeholder')}
              aria-label={t('Ticket Search Placeholder')}
            />
          </div>
        ) : null}
        <Button
          variant='ghost'
          size='icon-sm'
          disabled={refreshing}
          onClick={onRefresh}
          aria-label={t('Refresh')}
        >
          {refreshing ? (
            <Spinner className='size-3.5' />
          ) : (
            <RefreshCw className='size-3.5' />
          )}
        </Button>
        {extra}
      </div>

      {searchable ? (
        <p className='text-muted-foreground text-xs leading-relaxed'>
          {t('Ticket Search Scope Hint')}
        </p>
      ) : null}

      {notice ? (
        <p className='text-muted-foreground text-xs leading-relaxed'>{notice}</p>
      ) : null}
    </div>
  )
}

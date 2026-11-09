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
import { useTranslation } from 'react-i18next'

import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { AnyTicketView, TicketViewer } from '../types'
import { TicketStatusBadge } from './common'

export function TicketList({
  items,
  viewer,
  selectedId,
  onSelect,
}: {
  items: readonly AnyTicketView[]
  viewer: TicketViewer
  selectedId: number | null
  onSelect: (id: number) => void
}) {
  const { t } = useTranslation()

  return (
    <div className='min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-1'>
      {items.map((item) => {
        const submitter =
          viewer === 'admin' && 'username' in item
            ? String(item.username ?? '')
            : ''
        const selected = selectedId === item.id

        return (
          <button
            key={item.id}
            type='button'
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelect(item.id)}
            className={cn(
              'hover:bg-accent/60 w-full rounded-lg border px-3 py-2.5 text-start transition-colors',
              selected
                ? 'border-primary/40 bg-primary/8'
                : 'border-border/60 bg-background'
            )}
          >
            <div className='flex items-start justify-between gap-2'>
              <span className='min-w-0 flex-1 break-words text-sm font-medium leading-snug'>
                {item.title}
              </span>
              <TicketStatusBadge status={item.status} />
            </div>
            <div className='text-muted-foreground mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs'>
              <span>{t('Ticket ID')}: {item.id}</span>
              {submitter ? (
                <span>{t('Ticket Submitter')}: {submitter}</span>
              ) : null}
              <span>{t('Ticket Total Count')}: {item.message_count}</span>
            </div>
            <div className='text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs'>
              <span>{t('Ticket Created At')}: {formatTimestamp(item.created_at)}</span>
              <span>
                {t('Ticket Last Activity')}: {formatTimestamp(item.last_message_at)}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

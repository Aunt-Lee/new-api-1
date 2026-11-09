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

import {
  TicketEmptyState,
  TicketErrorState,
  TicketListPagination,
  TicketLoadingState,
} from '@/features/tickets/components/common'
import { TicketList } from '@/features/tickets/components/ticket-list'
import type { TicketAdminView } from '@/features/tickets/types'

/**
 * Admin list column: full five-state coverage (normal / empty / loading /
 * error / no-permission is handled by the route guard + page-level guard).
 */
export function AdminTicketList({
  items,
  isPending,
  isError,
  error,
  onRetry,
  filtered,
  searchNotice,
  selectedId,
  onSelect,
  page,
  pageSize,
  total,
  onPageChange,
}: {
  items: readonly TicketAdminView[]
  isPending: boolean
  isError: boolean
  error: unknown
  onRetry: () => void
  filtered: boolean
  searchNotice?: string
  selectedId: number | null
  onSelect: (id: number) => void
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()

  function renderContent() {
    if (isPending) return <TicketLoadingState />
    if (isError && items.length === 0) {
      return (
        <TicketErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={onRetry}
        />
      )
    }
    if (items.length === 0) {
      const description =
        searchNotice ??
        (filtered
          ? t('Ticket Empty Search Description')
          : t('Ticket Empty List Description'))
      return (
        <TicketEmptyState
          title={filtered ? t('Ticket Empty Search') : t('Ticket Empty List')}
          description={description}
        />
      )
    }
    return (
      <TicketList
        items={items}
        viewer='admin'
        selectedId={selectedId}
        onSelect={onSelect}
      />
    )
  }

  return (
    <>
      <div className='flex min-h-0 flex-1 flex-col pt-2'>{renderContent()}</div>

      <TicketListPagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
      />
    </>
  )
}

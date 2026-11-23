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
import { getRouteApi } from '@tanstack/react-router'
import { LifeBuoy } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

import { getAdminTickets } from '@/features/tickets/api'
import {
  TICKET_LIST_PAGE_SIZE,
  TICKET_QUERY_KEYS,
} from '@/features/tickets/constants'
import { TicketEmptyState, TicketNoPermission } from '@/features/tickets/components/common'
import { TicketDetailPanel } from '@/features/tickets/components/detail-panel'
import type { AdminListData, TicketStatus } from '@/features/tickets/types'

import { AdminTicketList } from './components/admin-list'
import { AdminTicketToolbar } from './components/admin-toolbar'

const route = getRouteApi('/_authenticated/ticket-management/')

// A1 `search_notice` carries a stable dot-free i18n key, not a localized
// sentence. Whitelist it so an older backend returning plain English prose
// degrades gracefully instead of showing a raw key.
const TICKET_SEARCH_NOTICE_KEYS = new Set([
  'Ticket Search Notice No Username',
  'Ticket Search Notice Multiple Usernames',
])

export function TicketManagement() {
  const { t } = useTranslation()

  const localizeNotice = (notice?: string) =>
    notice
      ? TICKET_SEARCH_NOTICE_KEYS.has(notice)
        ? t(notice)
        : notice
      : undefined
  const navigate = route.useNavigate()
  const { id } = route.useSearch()
  const queryClient = useQueryClient()
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)

  const [status, setStatus] = useState<string>('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)

  const selectedId = typeof id === 'number' && id > 0 ? id : null
  const filtered = status !== 'all' || keyword.trim() !== ''

  const listQuery = useQuery<AdminListData>({
    queryKey: [...TICKET_QUERY_KEYS.adminList, status, keyword, page] as const,
    queryFn: () =>
      getAdminTickets({
        p: page,
        page_size: TICKET_LIST_PAGE_SIZE,
        keyword,
        ...(status !== 'all' ? { status: status as TicketStatus } : {}),
      }),
    retry: false,
    placeholderData: (previous) => previous,
  })

  const items = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0

  function selectTicket(ticketId: number) {
    void navigate({ search: { id: ticketId } })
  }

  function closeDetail() {
    void navigate({ search: { id: undefined } })
  }

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.adminList })
  }

  // Defence in depth: the route `beforeLoad` already redirects to /403.
  if (role < ROLE.ADMIN) {
    return (
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>
          {t('Ticket Management')}
        </SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <TicketNoPermission />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Ticket Management')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='grid h-full min-h-0 gap-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]'>
          <div
            className={cn(
              'bg-background/40 border-border/60 flex h-full min-h-0 flex-col rounded-xl border p-2',
              selectedId ? 'hidden md:flex' : 'flex'
            )}
          >
            <AdminTicketToolbar
              status={status}
              onStatusChange={(next) => {
                setStatus(next)
                setPage(1)
              }}
              onKeywordChange={(next) => {
                setKeyword(next)
                setPage(1)
              }}
              onRefresh={refresh}
              refreshing={listQuery.isFetching}
              notice={localizeNotice(listQuery.data?.search_notice)}
            />

            <AdminTicketList
              items={items}
              isPending={listQuery.isPending}
              isError={listQuery.isError}
              error={listQuery.error}
              onRetry={() => void listQuery.refetch()}
              filtered={filtered}
              searchNotice={localizeNotice(listQuery.data?.search_notice)}
              selectedId={selectedId}
              onSelect={selectTicket}
              page={page}
              pageSize={TICKET_LIST_PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />

            {listQuery.isError && items.length > 0 ? (
              <p className='text-destructive shrink-0 px-1 pt-1 text-xs'>
                {t('Ticket Load Error')}
              </p>
            ) : null}
          </div>

          <div
            className={cn(
              'border-border/60 h-full min-h-0 overflow-hidden rounded-xl border',
              selectedId ? 'flex' : 'hidden md:flex'
            )}
          >
            {selectedId ? (
              <TicketDetailPanel
                ticketId={selectedId}
                viewer='admin'
                onClose={closeDetail}
              />
            ) : (
              <TicketEmptyState
                icon={<LifeBuoy className='size-4' />}
                title={t('Ticket Detail')}
                description={t('Ticket Select Hint')}
              />
            )}
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

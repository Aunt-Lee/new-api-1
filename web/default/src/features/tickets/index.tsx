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
import { LifeBuoy, Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout/components/section-page-layout'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { cn } from '@/lib/utils'

import { getTickets } from './api'
import {
  TICKET_LIST_PAGE_SIZE,
  TICKET_QUERY_KEYS,
} from './constants'
import {
  TicketEmptyState,
  TicketErrorState,
  TicketListPagination,
  TicketLoadingState,
  TicketNoPermission,
} from './components/common'
import { TicketDetailPanel } from './components/detail-panel'
import { NewTicketDialog } from './components/new-ticket-dialog'
import { TicketList } from './components/ticket-list'
import { TicketToolbar } from './components/ticket-toolbar'
import type { PageInfo, TicketSelfView, TicketStatus } from './types'

const route = getRouteApi('/_authenticated/tickets/')

export function Tickets() {
  const { t } = useTranslation()
  const navigate = route.useNavigate()
  const { id } = route.useSearch()
  const queryClient = useQueryClient()
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)

  const [status, setStatus] = useState<string>('all')
  const [page, setPage] = useState(1)
  const [newOpen, setNewOpen] = useState(false)

  const selectedId = typeof id === 'number' && id > 0 ? id : null

  const listQuery = useQuery<PageInfo<TicketSelfView>>({
    queryKey: [...TICKET_QUERY_KEYS.list, status, page] as const,
    queryFn: () =>
      getTickets({
        p: page,
        page_size: TICKET_LIST_PAGE_SIZE,
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
    void queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.list })
  }

  function renderListContent() {
    if (listQuery.isPending) return <TicketLoadingState />
    if (listQuery.isError && !listQuery.data) {
      return (
        <TicketErrorState
          message={
            listQuery.error instanceof Error
              ? listQuery.error.message
              : undefined
          }
          onRetry={() => void listQuery.refetch()}
        />
      )
    }
    if (items.length === 0) {
      return (
        <TicketEmptyState
          title={
            status === 'all'
              ? t('Ticket Empty List')
              : t('Ticket Empty Search')
          }
          description={
            status === 'all'
              ? t('Ticket Empty List Description')
              : t('Ticket Empty Search Description')
          }
          action={
            <Button size='sm' onClick={() => setNewOpen(true)}>
              {t('Ticket New')}
            </Button>
          }
        />
      )
    }
    return (
      <TicketList
        items={items}
        viewer='user'
        selectedId={selectedId}
        onSelect={selectTicket}
      />
    )
  }

  if (role < ROLE.USER) {
    return (
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('My Tickets')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <TicketNoPermission description={t('Ticket Login Required')} />
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('My Tickets')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        <Button size='sm' onClick={() => setNewOpen(true)}>
          <Plus className='size-3.5' />
          {t('Ticket New')}
        </Button>
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='grid h-full min-h-0 gap-3 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]'>
          {/* List column */}
          <div
            className={cn(
              'bg-background/40 border-border/60 flex h-full min-h-0 flex-col rounded-xl border p-2',
              selectedId ? 'hidden md:flex' : 'flex'
            )}
          >
            <TicketToolbar
              status={status}
              onStatusChange={(next) => {
                setStatus(next)
                setPage(1)
              }}
              onRefresh={refresh}
              refreshing={listQuery.isFetching}
            />

            <div className='flex min-h-0 flex-1 flex-col pt-2'>
              {renderListContent()}
            </div>

            <TicketListPagination
              page={page}
              pageSize={TICKET_LIST_PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </div>

          {/* Detail column: `?id=` driven in-page panel, no third route. */}
          <div
            className={cn(
              'border-border/60 h-full min-h-0 overflow-hidden rounded-xl border',
              selectedId ? 'flex' : 'hidden md:flex'
            )}
          >
            {selectedId ? (
              <TicketDetailPanel
                ticketId={selectedId}
                viewer='user'
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

          <NewTicketDialog
            open={newOpen}
            onOpenChange={setNewOpen}
            onCreated={selectTicket}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

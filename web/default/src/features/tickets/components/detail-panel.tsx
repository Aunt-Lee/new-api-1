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
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { formatTimestamp } from '@/lib/format'

import {
  adminChangeTicketStatus,
  adminMarkTicketRead,
  adminReplyToTicket,
  changeTicketStatusByUser,
  getAdminTicketDetail,
  getTicketDetail,
  markTicketRead,
  replyToTicket,
  TicketApiError,
} from '../api'
import { TICKET_QUERY_KEYS } from '../constants'
import {
  TICKET_UNREAD_POLL_MS,
  useApplyUnreadCount,
} from '../hooks'
import { isTicketReplyable, validateTicketContent } from '../lib'
import type {
  AnyTicketView,
  DetailData,
  TicketStatus,
  TicketViewer,
} from '../types'
import {
  TicketErrorState,
  TicketLoadingState,
  TicketStatusBadge,
  TicketStatusSelect,
} from './common'
import { TicketComposer, TicketConversation } from './conversation'

type PendingAction = 'reply' | 'close' | 'reopen' | 'status' | null

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function TicketDetailPanel({
  ticketId,
  viewer,
  onClose,
}: {
  ticketId: number
  viewer: TicketViewer
  onClose: () => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const applyUnreadCount = useApplyUnreadCount()

  const [draft, setDraft] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const [inlineError, setInlineError] = useState<string | null>(null)
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [statusChoice, setStatusChoice] = useState<string>('pending')
  const markedKeyRef = useRef('')

  const queryKey = [...TICKET_QUERY_KEYS.detail, viewer, ticketId] as const

  // The detail stream reuses the SAME polling constant as the unread badge;
  // no separate timer is created. New rows are appended by refetch with stable
  // `key={id}` and no automatic mark-as-read.
  const detailQuery = useQuery<DetailData<AnyTicketView>>({
    queryKey,
    queryFn: async (): Promise<DetailData<AnyTicketView>> =>
      viewer === 'user'
        ? getTicketDetail(ticketId)
        : getAdminTicketDetail(ticketId),
    enabled: Number.isFinite(ticketId) && ticketId > 0,
    refetchInterval: TICKET_UNREAD_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    staleTime: 0,
    retry: false,
    // No placeholderData here: while switching `?id=` we must never briefly
    // render the previous ticket's conversation under the new ticket's key.
  })

  const detail = detailQuery.data
  const ticket: AnyTicketView | undefined = detail?.ticket
  const currentStatus: TicketStatus = ticket?.status ?? 'pending'
  const messages = detail?.replies ?? []
  const submitter =
    ticket && 'username' in ticket ? String(ticket.username ?? '') : ''

  // A draft belongs to exactly one ticket. Reset it when the opened ticket or
  // the viewer changes; polling refetches never touch it (deps are stable).
  useEffect(() => {
    setDraft('')
    setInlineError(null)
  }, [ticketId, viewer])

  // Keep the admin status dropdown aligned with the real current status, but
  // only when the status / ticket actually changes (never on every poll).
  useEffect(() => {
    setStatusChoice(currentStatus)
  }, [currentStatus, ticketId])

  // U7 / A6: mark read ONCE per opened ticket. Polled new rows never trigger
  // an automatic read. The result's `count` updates the shared badge cache.
  useEffect(() => {
    const key = `${viewer}:${ticketId}`
    if (!Number.isFinite(ticketId) || ticketId <= 0) return
    if (markedKeyRef.current === key) return
    markedKeyRef.current = key

    const scope = viewer === 'user' ? 'self' : 'global'
    void (async () => {
      try {
        const result =
          viewer === 'user'
            ? await markTicketRead(ticketId)
            : await adminMarkTicketRead(ticketId)
        applyUnreadCount(scope, result?.count ?? 0)
      } catch {
        // Best-effort: a failed read is self-healed by the next unread poll,
        // and must never break the detail page.
      }
    })()
  }, [ticketId, viewer, applyUnreadCount])

  async function runAction(
    kind: Exclude<PendingAction, null>,
    request: () => Promise<unknown>,
    successKey: string,
    clearDraft: boolean
  ) {
    if (pendingAction) return
    setInlineError(null)
    setPendingAction(kind)
    try {
      await request()
      toast.success(t(successKey))
      if (clearDraft) setDraft('')
      setStatusChoice(currentStatus)
      await queryClient.invalidateQueries({ queryKey })
      void queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.list })
      void queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.adminList })
    } catch (error) {
      setInlineError(errorMessage(error, t('Something went wrong!')))
    } finally {
      setPendingAction(null)
    }
  }

  function submitReply() {
    const validationKey = validateTicketContent(draft)
    if (validationKey) {
      setInlineError(t(validationKey))
      return
    }
    const content = draft

    if (viewer === 'admin') {
      const payload: { content: string; status?: TicketStatus } = { content }
      // Only transmit `status` when it was explicitly changed; selecting the
      // current status is a no-op and must not produce a status event.
      if (statusChoice !== currentStatus && statusChoice !== 'all') {
        payload.status = statusChoice as TicketStatus
      }
      void runAction(
        'reply',
        () => adminReplyToTicket(ticketId, payload),
        'Ticket Replied',
        true
      )
      return
    }

    // `closed` supports the one-step "reopen and keep asking" (U5 reopen:true).
    const reopen = !isTicketReplyable(currentStatus)
    void runAction(
      'reply',
      () => replyToTicket(ticketId, { content, ...(reopen ? { reopen: true } : {}) }),
      'Ticket Replied',
      true
    )
  }

  function closeTicket() {
    void runAction(
      'close',
      () => changeTicketStatusByUser(ticketId, 'close'),
      'Ticket Closed Success',
      false
    )
  }

  function reopenTicket() {
    void runAction(
      'reopen',
      () => changeTicketStatusByUser(ticketId, 'reopen'),
      'Ticket Reopened',
      false
    )
  }

  function updateStatusOnly() {
    if (statusChoice === currentStatus || statusChoice === 'all') return
    void runAction(
      'status',
      () => adminChangeTicketStatus(ticketId, statusChoice as TicketStatus),
      'Ticket Status Updated',
      false
    )
  }

  if (detailQuery.isPending) {
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <TicketLoadingState label={t('Loading')} />
      </div>
    )
  }

  if (!detail || !ticket) {
    const notFound =
      detailQuery.error instanceof TicketApiError &&
      detailQuery.error.code === 'ticket.not_found'
    return (
      <div className='flex h-full min-h-0 flex-col'>
        <TicketErrorState
          message={
            notFound
              ? t('Ticket Not Found')
              : errorMessage(detailQuery.error, t('Ticket Detail Load Error'))
          }
          onRetry={() => void detailQuery.refetch()}
        />
        <div className='flex justify-center pb-2'>
          <Button variant='ghost' size='sm' onClick={onClose}>
            {t('Ticket Back To List')}
          </Button>
        </div>
      </div>
    )
  }

  const canReply = viewer === 'user' ? true : isTicketReplyable(currentStatus)
  const isClosed = !isTicketReplyable(currentStatus)

  const adminStatusControls = viewer === 'admin' ? (
    <div className='space-y-1.5'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground text-xs'>{t('Status')}</span>
        <TicketStatusSelect
          value={statusChoice}
          onValueChange={setStatusChoice}
          ariaLabel={t('Status')}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={
            pendingAction !== null ||
            statusChoice === currentStatus ||
            statusChoice === 'all'
          }
          onClick={updateStatusOnly}
        >
          {t('Ticket Update Status')}
        </Button>
      </div>
      <p className='text-muted-foreground text-xs leading-relaxed'>
        {t('Ticket Status Select Hint')}
      </p>
    </div>
  ) : null

  let replyHint: string | null = null
  if (isClosed) {
    replyHint =
      viewer === 'user'
        ? t('Ticket Closed Reply Hint')
        : t('Ticket Admin Closed Hint')
  }

  const submitLabel =
    viewer === 'user' && isClosed
      ? t('Ticket Reopen And Reply')
      : t('Ticket Send Reply')

  return (
    <div className='bg-background flex h-full min-h-0 flex-col'>
      {/* Header */}
      <div className='shrink-0 space-y-2 border-b px-3 py-3 sm:px-4'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <div className='flex flex-wrap items-center gap-2'>
              <h3 className='min-w-0 break-words text-sm font-semibold'>
                {ticket.title}
              </h3>
              <TicketStatusBadge status={currentStatus} />
            </div>
            <div className='text-muted-foreground mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs'>
              <span>{t('Ticket ID')}: {ticket.id}</span>
              {viewer === 'admin' && submitter ? (
                <span>{t('Ticket Submitter')}: {submitter}</span>
              ) : null}
              <span>{t('Ticket Created At')}: {formatTimestamp(ticket.created_at)}</span>
              <span>
                {t('Ticket Last Activity')}: {formatTimestamp(ticket.last_message_at)}
              </span>
            </div>
          </div>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label={t('Ticket Close Detail')}
            onClick={onClose}
          >
            <X className='size-4' />
          </Button>
        </div>

        {viewer === 'user' ? (
          <div className='flex flex-wrap items-center gap-2'>
            {!isClosed ? (
              <Button
                size='sm'
                variant='outline'
                disabled={pendingAction !== null}
                onClick={() =>
                  currentStatus === 'pending'
                    ? setConfirmCloseOpen(true)
                    : closeTicket()
                }
              >
                {t('Ticket Close')}
              </Button>
            ) : null}
            {currentStatus === 'closed' || currentStatus === 'resolved' ? (
              <Button
                size='sm'
                variant='outline'
                disabled={pendingAction !== null}
                onClick={reopenTicket}
              >
                {t('Ticket Reopen')}
              </Button>
            ) : null}
          </div>
        ) : (
          <p className='text-muted-foreground text-xs leading-relaxed'>
            {t('Ticket Shared Read Hint')}
          </p>
        )}
      </div>

      {/* Inline error: keep the conversation (and the draft) mounted. */}
      {inlineError ? (
        <div className='bg-destructive/10 text-destructive shrink-0 px-3 py-2 text-xs sm:px-4'>
          {inlineError}
        </div>
      ) : null}
      {detailQuery.isError ? (
        <div className='bg-destructive/10 text-destructive flex shrink-0 items-center justify-between gap-2 px-3 py-2 text-xs sm:px-4'>
          <span>{t('Ticket Load Error')}</span>
          <Button size='xs' variant='ghost' onClick={() => void detailQuery.refetch()}>
            {t('Retry')}
          </Button>
        </div>
      ) : null}

      {/* Conversation: no pagination, no infinite scroll, fixed recent 200. */}
      <div className='min-h-0 flex-1 px-3 pt-3 sm:px-4'>
        <TicketConversation
          messages={messages}
          total={detail.total}
          hasMore={detail.has_more}
          viewer={viewer}
          ticketId={ticketId}
        />
      </div>

      {/* Composer: mounted once, never keyed by the stream. */}
      <div className='shrink-0 px-3 pb-3 sm:px-4'>
        {canReply ? (
          <TicketComposer
            value={draft}
            onValueChange={setDraft}
            onSubmit={submitReply}
            submitting={pendingAction === 'reply'}
            disabled={pendingAction !== null && pendingAction !== 'reply'}
            submitLabel={submitLabel}
            placeholder={t('Ticket Reply Placeholder')}
            hint={
              replyHint ? (
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {replyHint}
                </p>
              ) : null
            }
            extra={adminStatusControls}
          />
        ) : (
          <div className='space-y-2 border-t pt-3'>
            <p className='text-muted-foreground text-xs leading-relaxed'>
              {t('Ticket Admin Closed Hint')}
            </p>
            {adminStatusControls}
          </div>
        )}
      </div>

      {/* `pending` close needs a second confirmation (§8.2). */}
      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Ticket Close Confirm Title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('Ticket Close Confirm Description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={pendingAction !== null}
              onClick={() => {
                setConfirmCloseOpen(false)
                closeTicket()
              }}
            >
              {t('Ticket Confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

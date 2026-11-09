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
import { useEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { formatTimestamp } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  TICKET_CONTENT_MAX_RUNES,
  TICKET_DETAIL_STREAM_LIMIT,
} from '../constants'
import { countReplies, countRunes, describeTicketEvent, isOwnMessage } from '../lib'
import type { MessageView, TicketViewer } from '../types'
import { TicketSensitiveHint } from './common'

/**
 * `kind='event'` rows are rendered as a centered, lightweight system notice.
 *
 * The text is assembled ONLY from `event_type` / `from_status` / `to_status`
 * through parameterized i18n keys. `content` (always ""), `author_username`,
 * `author_user_id` and every other identity field are ignored, so no user
 * input, no admin account and no username snapshot can appear here.
 */
function TicketEventNotice({
  message,
  viewer,
}: {
  message: MessageView
  viewer: TicketViewer
}) {
  const { t } = useTranslation()
  const descriptor = describeTicketEvent(message, viewer)
  const text = t(descriptor.key, {
    actor: descriptor.actorKey ? t(descriptor.actorKey) : '',
    from: t(descriptor.fromKey),
    to: t(descriptor.toKey),
  })

  return (
    <div className='my-3 flex justify-center px-2'>
      <span
        className='bg-muted text-muted-foreground max-w-full rounded-full px-3 py-1 text-center text-xs leading-relaxed'
        title={formatTimestamp(message.created_at)}
      >
        {text}
      </span>
    </div>
  )
}

function TicketMessageBubble({
  message,
  viewer,
}: {
  message: MessageView
  viewer: TicketViewer
}) {
  const { t } = useTranslation()
  const own = isOwnMessage(message, viewer)
  let label: string
  if (own) {
    label = viewer === 'user' ? t('Ticket Role You') : t('Ticket Role Admin')
  } else {
    label = viewer === 'user' ? t('Ticket Role Admin') : t('Ticket Role User')
  }

  return (
    <div className={cn('flex flex-col gap-1', own ? 'items-end' : 'items-start')}>
      <div className='text-muted-foreground flex items-center gap-2 px-1 text-xs'>
        <span>{label}</span>
        <span>{formatTimestamp(message.created_at)}</span>
      </div>
      <div
        className={cn(
          'border-border/60 max-w-[85%] whitespace-pre-wrap break-words rounded-lg border px-3 py-2 text-sm leading-relaxed',
          own ? 'bg-primary/8 rounded-tr-sm' : 'bg-muted/60 rounded-tl-sm'
        )}
      >
        {message.content}
      </div>
    </div>
  )
}

export function TicketConversation({
  messages,
  total,
  hasMore,
  viewer,
  ticketId,
}: {
  messages: readonly MessageView[]
  total: number
  hasMore: boolean
  viewer: TicketViewer
  ticketId: number
}) {
  const { t } = useTranslation()
  const replyCount = countReplies(messages)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCountRef = useRef(-1)

  useEffect(() => {
    lastCountRef.current = -1
  }, [ticketId])

  // Poll-appended rows keep the view pinned to the newest message, but only
  // when the reader is already near the bottom (never yank a scrolled-up view).
  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const nearBottom =
      lastCountRef.current === -1 ||
      element.scrollHeight - element.scrollTop - element.clientHeight < 140
    if (nearBottom) element.scrollTop = element.scrollHeight
    lastCountRef.current = messages.length
  }, [messages.length, ticketId])

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-2 text-xs'>
        <span>{t('Ticket Reply Count')}: {replyCount}</span>
        <span>{t('Ticket Total Count')}: {total}</span>
      </div>

      {hasMore ? (
        <div className='bg-muted/60 text-muted-foreground mb-3 shrink-0 rounded-md px-3 py-2 text-center text-xs'>
          {t('Ticket Has More', { shown: TICKET_DETAIL_STREAM_LIMIT })}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className='min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-1 pb-4'
      >
        {messages.length === 0 ? (
          <div className='text-muted-foreground py-10 text-center text-sm'>
            {t('Ticket Empty Conversation')}
          </div>
        ) : (
          messages.map((message) =>
            message.kind === 'event' ? (
              <TicketEventNotice key={message.id} message={message} viewer={viewer} />
            ) : (
              <TicketMessageBubble
                key={message.id}
                message={message}
                viewer={viewer}
              />
            )
          )
        )}
      </div>
    </div>
  )
}

/**
 * Presentational composer. It is mounted once per detail panel and is never
 * keyed by the message list, so polling/stream updates cannot reset a draft.
 */
export function TicketComposer({
  value,
  onValueChange,
  onSubmit,
  submitting,
  disabled = false,
  submitLabel,
  placeholder,
  hint,
  extra,
}: {
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  submitting: boolean
  disabled?: boolean
  submitLabel: string
  placeholder: string
  hint?: ReactNode
  extra?: ReactNode
}) {
  const { t } = useTranslation()
  const runes = countRunes(value)
  const tooLong = runes > TICKET_CONTENT_MAX_RUNES

  return (
    <div className='shrink-0 space-y-2 border-t pt-3'>
      <TicketSensitiveHint />
      {hint}
      {extra}
      <Textarea
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled || submitting}
        rows={3}
        aria-label={placeholder}
      />
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span
          className={cn(
            'text-muted-foreground text-xs',
            tooLong && 'text-destructive'
          )}
        >
          {t('Ticket Counter', { used: runes, max: TICKET_CONTENT_MAX_RUNES })}
        </span>
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            disabled={submitting || disabled || value.length === 0}
            onClick={() => onValueChange('')}
          >
            {t('Reset')}
          </Button>
          <Button
            size='sm'
            disabled={submitting || disabled || value.length === 0}
            onClick={onSubmit}
          >
            {submitting ? <Spinner className='size-3.5' /> : null}
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

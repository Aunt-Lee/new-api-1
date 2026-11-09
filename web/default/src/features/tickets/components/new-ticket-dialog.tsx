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
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { createTicket } from '../api'
import {
  TICKET_CONTENT_MAX_RUNES,
  TICKET_QUERY_KEYS,
  TICKET_TITLE_MAX_RUNES,
} from '../constants'
import { countRunes, validateTicketContent, validateTicketTitle } from '../lib'
import { TicketSensitiveHint } from './common'

export function NewTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (id: number) => void
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const titleRunes = countRunes(title)
  const contentRunes = countRunes(content)

  function reset() {
    setTitle('')
    setContent('')
    setError(null)
  }

  function handleOpenChange(next: boolean) {
    if (submitting) return
    if (!next) reset()
    onOpenChange(next)
  }

  async function handleSubmit() {
    const titleKey = validateTicketTitle(title)
    if (titleKey) {
      setError(t(titleKey))
      return
    }
    const contentKey = validateTicketContent(content)
    if (contentKey) {
      setError(t(contentKey))
      return
    }

    setError(null)
    setSubmitting(true)
    try {
      const result = await createTicket({ title, content })
      toast.success(t('Ticket Created'))
      await queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.list })
      void queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.adminList })
      void queryClient.invalidateQueries({ queryKey: TICKET_QUERY_KEYS.unread })
      reset()
      onOpenChange(false)
      if (result && typeof result.id === 'number' && result.id > 0) {
        onCreated(result.id)
      }
    } catch (caught) {
      setError(
        caught instanceof Error && caught.message
          ? caught.message
          : t('Something went wrong!')
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title={t('Ticket New')}
      contentClassName='sm:max-w-xl'
      footer={
        <>
          <Button
            variant='outline'
            disabled={submitting}
            onClick={() => handleOpenChange(false)}
          >
            {t('Cancel')}
          </Button>
          <Button disabled={submitting} onClick={() => void handleSubmit()}>
            {submitting ? <Spinner className='size-3.5' /> : null}
            {t('Submit')}
          </Button>
        </>
      }
    >
      <div className='space-y-4'>
        <div className='space-y-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <Label htmlFor='ticket-new-title'>{t('Ticket Title')}</Label>
            <span
              className={cn(
                'text-muted-foreground text-xs',
                titleRunes > TICKET_TITLE_MAX_RUNES && 'text-destructive'
              )}
            >
              {t('Ticket Counter', {
                used: titleRunes,
                max: TICKET_TITLE_MAX_RUNES,
              })}
            </span>
          </div>
          <Input
            id='ticket-new-title'
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={t('Ticket Title Placeholder')}
            disabled={submitting}
          />
        </div>

        <div className='space-y-1.5'>
          <div className='flex items-center justify-between gap-2'>
            <Label htmlFor='ticket-new-content'>{t('Ticket Content')}</Label>
            <span
              className={cn(
                'text-muted-foreground text-xs',
                contentRunes > TICKET_CONTENT_MAX_RUNES && 'text-destructive'
              )}
            >
              {t('Ticket Counter', {
                used: contentRunes,
                max: TICKET_CONTENT_MAX_RUNES,
              })}
            </span>
          </div>
          <Textarea
            id='ticket-new-content'
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder={t('Ticket Content Placeholder')}
            rows={6}
            disabled={submitting}
          />
        </div>

        <TicketSensitiveHint />

        {error ? (
          <p className='bg-destructive/10 text-destructive rounded-md px-3 py-2 text-xs'>
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}

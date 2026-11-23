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
import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, LifeBuoy, LockKeyhole } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

import { TICKET_STATUSES, TICKET_STATUS_KEY } from '../constants'
import { ticketStatusKey } from '../lib'

const STATUS_CLASS: Record<string, string> = {
  pending:
    'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  processing:
    'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  resolved:
    'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  closed: 'border-border bg-muted text-muted-foreground',
}

export function TicketStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation()
  return (
    <Badge
      variant='outline'
      className={cn('shrink-0', STATUS_CLASS[status] ?? STATUS_CLASS.closed)}
    >
      {t(ticketStatusKey(status))}
    </Badge>
  )
}

export function TicketStatusSelect({
  value,
  onValueChange,
  includeAll = false,
  disabled = false,
  className,
  ariaLabel,
}: {
  value: string
  onValueChange: (value: string) => void
  includeAll?: boolean
  disabled?: boolean
  className?: string
  ariaLabel?: string
}) {
  const { t } = useTranslation()
  const statusOptions = TICKET_STATUSES.map((status) => ({
    value: status,
    label: t(TICKET_STATUS_KEY[status]),
  }))
  const options = includeAll
    ? [{ value: 'all', label: t('Ticket All Statuses') }, ...statusOptions]
    : statusOptions

  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(String(next))
      }}
      disabled={disabled}
    >
      <SelectTrigger className={className} aria-label={ariaLabel}>
        <SelectValue placeholder={t('Status')} />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function TicketSensitiveHint() {
  const { t } = useTranslation()
  return (
    <p className='text-muted-foreground text-xs leading-relaxed'>
      {t('Ticket Sensitive Hint')}
    </p>
  )
}

export function TicketLoadingState({ label }: { label?: string }) {
  const { t } = useTranslation()
  return (
    <div className='flex h-full min-h-40 w-full items-center justify-center gap-2'>
      <Spinner className='size-4' />
      <span className='text-muted-foreground text-sm'>
        {label ?? t('Loading')}
      </span>
    </div>
  )
}

export function TicketErrorState({
  message,
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className='flex h-full min-h-40 w-full items-center justify-center p-6'>
      <Empty className='border-border/60 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <AlertCircle className='size-4' />
          </EmptyMedia>
          <EmptyTitle>{t('Ticket Load Error')}</EmptyTitle>
          <EmptyDescription>{message ?? t('Something went wrong!')}</EmptyDescription>
        </EmptyHeader>
        {onRetry ? (
          <EmptyContent>
            <Button variant='outline' size='sm' onClick={onRetry}>
              {t('Retry')}
            </Button>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  )
}

export function TicketEmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: string
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className='flex h-full min-h-40 w-full items-center justify-center p-6'>
      <Empty className='border-border/60 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>{icon ?? <LifeBuoy className='size-4' />}</EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </Empty>
    </div>
  )
}

export function TicketNoPermission({
  description,
}: {
  description?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className='flex h-full w-full items-center justify-center p-6'>
      <Empty className='border-border/60 border'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <LockKeyhole className='size-4' />
          </EmptyMedia>
          <EmptyTitle>{t('Ticket No Permission')}</EmptyTitle>
          <EmptyDescription>
            {description ?? t('Ticket No Permission Description')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant='outline'
            size='sm'
            onClick={() => void navigate({ to: '/' })}
          >
            {t('Back')}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}

/**
 * Server-side pagination for the ticket LIST (§8.2 "状态筛选 + 分页").
 * The detail conversation has NO pagination / infinite scroll at all: U4/A3
 * return only the most recent 200 entries and there is no history endpoint.
 */
export function TicketListPagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const { t } = useTranslation()
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  if (pageCount <= 1) return null

  return (
    <div className='flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-1 pt-2'>
      <span className='text-muted-foreground text-xs'>
        {t('Ticket Page Info', { page, total })}
      </span>
      <div className='flex items-center gap-1'>
        <Button
          variant='ghost'
          size='sm'
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          {t('Previous')}
        </Button>
        <Button
          variant='ghost'
          size='sm'
          disabled={page >= pageCount}
          onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        >
          {t('Next')}
        </Button>
      </div>
    </div>
  )
}

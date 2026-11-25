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
import { Check, Expand, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import type { AdminDegradationTest } from '../types'

// Encode SVG as a data URI and render it inside an <img>. Images are an inert
// context: scripts inside untrusted model output never execute. SMIL <animate>
// still plays in this context.
function svgDataUri(content: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`
}

function formatTime(ts: number): string {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type Props = {
  row: AdminDegradationTest
  pending?: boolean
  onPublish?: (id: number) => void
  onDiscard?: (id: number) => void
  actionBusy?: boolean
}

export function DegradationResultCard(props: Props) {
  const { t } = useTranslation()
  const { row } = props
  const [zoomed, setZoomed] = useState(false)
  const ok = row.status === 'success' && !!row.content

  const preview = ok ? (
    <img
      src={svgDataUri(row.content as string)}
      alt={t('A little crocodile riding a bicycle')}
      className='h-full w-full object-contain'
    />
  ) : (
    <div className='text-muted-foreground max-w-full text-center text-xs break-words'>
      {row.fail_reason || t('No preview available')}
    </div>
  )

  return (
    <>
      <div className='bg-background flex flex-col overflow-hidden rounded-md border'>
        <div className='flex items-center justify-between gap-2 border-b px-3 py-2'>
          <div className='flex min-w-0 items-center gap-2'>
            <span className='truncate text-sm font-medium'>{row.group}</span>
            <Badge variant={ok ? 'secondary' : 'destructive'} className='shrink-0'>
              {row.status}
            </Badge>
          </div>
          <span className='text-muted-foreground shrink-0 font-mono text-[11px]'>
            #{row.id} · {formatTime(row.created_at)}
          </span>
        </div>

        <div className='group/preview bg-muted/30 relative flex h-56 items-center justify-center p-3'>
          {preview}
          {ok && (
            <button
              type='button'
              onClick={() => setZoomed(true)}
              className='bg-background/80 hover:bg-background absolute right-2 bottom-2 flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] shadow-xs transition-opacity'
              title={t('View full size')}
            >
              <Expand className='size-3' aria-hidden='true' />
              {t('View full size')}
            </button>
          )}
        </div>

        <div className='text-muted-foreground border-t px-3 py-1.5 font-mono text-[11px]'>
          {row.model_name}
        </div>

        {props.pending && (
          <div className={cn('mt-auto flex items-center gap-2 border-t px-3 py-2')}>
            <Button
              type='button'
              size='sm'
              disabled={!ok || props.actionBusy}
              onClick={() => props.onPublish?.(row.id)}
            >
              <Check className='size-3.5' aria-hidden='true' />
              {t('Publish')}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={props.actionBusy}
              onClick={() => props.onDiscard?.(row.id)}
            >
              <Trash2 className='size-3.5' aria-hidden='true' />
              {t('Discard')}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={zoomed} onOpenChange={setZoomed}>
        <DialogContent className='max-h-[90vh] max-w-4xl overflow-auto'>
          <DialogHeader>
            <DialogTitle className='text-sm'>
              {row.group} · <span className='font-mono'>{row.model_name}</span>
            </DialogTitle>
            <DialogDescription className='text-xs'>
              #{row.id} · {formatTime(row.created_at)}
            </DialogDescription>
          </DialogHeader>
          <div className='bg-muted/30 flex min-h-[300px] items-center justify-center rounded-md border p-4'>
            {preview}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

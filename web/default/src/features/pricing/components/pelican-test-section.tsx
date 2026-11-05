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
import { useQuery } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { ImageOff, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { getPelicanTests, type PelicanTestResult } from '../api'

const PROBE_GROUPS = ['Gpt Plus&Team', 'Gpt Pro']
const PROBE_HISTORY_SIZE = 4

// Loading an SVG through <img> keeps it in an inert image context: scripts
// inside the SVG never execute, unlike injecting it into the page DOM.
// The backend also rejects SVGs containing <script>/<foreignObject>.
function toSvgDataUrl(svg: string): string {
  const normalized = /<svg[^>]*\sxmlns=/i.test(svg)
    ? svg
    : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`
}

function hasValidImage(result?: PelicanTestResult): boolean {
  return Boolean(result?.content && result?.status === 'success')
}

function ProbeCard({
  group,
  results,
  isLoading,
}: {
  group: string
  results: PelicanTestResult[]
  isLoading: boolean
}) {
  const { t } = useTranslation()
  const latest = results[0]
  const anyImage = results.some(hasValidImage)

  return (
    <div className='bg-card rounded-xl border p-3'>
      <div className='flex flex-wrap items-center justify-between gap-1.5'>
        <span className='text-sm font-semibold'>{group}</span>
        <span className='text-muted-foreground font-mono text-[11px]'>
          {latest?.model_name ?? 'gpt-6.1-sol'}
        </span>
      </div>

      <div className='my-3 grid grid-cols-4 gap-1.5'>
        {Array.from({ length: PROBE_HISTORY_SIZE }, (_, index) => {
          const item = results[index]
          const exactTime = item
            ? dayjs(item.created_at * 1000).format('YYYY-MM-DD HH:mm:ss')
            : ''
          const svg =
            item && item.status === 'success' && item.content
              ? toSvgDataUrl(item.content)
              : ''

          return (
            <div
              key={index}
              title={exactTime || undefined}
              className={`flex min-w-0 flex-col gap-1 rounded-lg border p-1 ${
                item ? '' : 'border-border/60 border-dashed'
              }`}
            >
              <div className='flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-white'>
                {isLoading ? (
                  <span className='bg-muted h-full w-full animate-pulse' />
                ) : svg ? (
                  <img
                    src={svg}
                    alt={t('A pelican riding a bicycle')}
                    referrerPolicy='no-referrer'
                    className='h-full w-full object-contain'
                  />
                ) : (
                  <ImageOff className='text-muted-foreground h-4 w-4 opacity-40' />
                )}
              </div>
              <span className='text-muted-foreground w-full truncate text-center font-mono text-[10px] tabular-nums'>
                {item
                  ? dayjs(item.created_at * 1000).format('MM-DD HH:mm')
                  : '—'}
              </span>
            </div>
          )
        })}
      </div>

      <div className='text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]'>
        <span className='inline-flex items-center gap-1'>
          <ShieldCheck className='h-3 w-3 text-emerald-500' />
          {results.length === 0
            ? t('No test result yet')
            : anyImage
              ? t('Raw model output, unedited')
              : t('The last test did not produce a valid image')}
        </span>
      </div>
    </div>
  )
}

export function PelicanTestSection() {
  const { t } = useTranslation()
  const query = useQuery({
    queryKey: ['pelican-tests'],
    queryFn: getPelicanTests,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  })
  const results = query.data ?? []

  return (
    <Card size='sm' className='mt-5'>
      <CardHeader>
        <div className='min-w-0'>
          <CardTitle className='flex items-center gap-2'>
            <ShieldCheck className='h-4 w-4 text-emerald-500' />
            {t('Model Degradation Test')}
          </CardTitle>
          <p className='text-muted-foreground mt-1.5 text-xs leading-relaxed'>
            {t(
              'At a random time, we ask each group to draw an SVG of a pelican riding a bicycle. The untouched model output is shown here.'
            )}
          </p>
        </div>
      </CardHeader>
      <CardContent>
        <div className='grid gap-3 sm:grid-cols-2'>
          {PROBE_GROUPS.map((group) => (
            <ProbeCard
              key={group}
              group={group}
              results={results.filter((item) => item.group === group)}
              isLoading={query.isLoading}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

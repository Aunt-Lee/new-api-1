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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Play, RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import {
  discardDegradationTest,
  listDegradationTests,
  listProbeGroups,
  publishDegradationTest,
  runDegradationTests,
} from './api'
import { DegradationResultCard } from './components/result-card'
import type { AdminDegradationTest, ProbeGroup } from './types'

const QUERY_KEY = ['degradation-detection', 'list']
const GROUPS_KEY = ['degradation-detection', 'groups']

export function DegradationDetection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [runConflict, setRunConflict] = useState(false)
  const [selectedGroups, setSelectedGroups] = useState<string[]>([])

  const listQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await listDegradationTests()
      if (!res.success || !Array.isArray(res.data)) {
        throw new Error(res.message || t('We could not load probe results.'))
      }
      return res.data
    },
    staleTime: 15 * 1000,
    retry: false,
  })

  const groupsQuery = useQuery({
    queryKey: GROUPS_KEY,
    queryFn: async () => {
      const res = await listProbeGroups()
      if (!res.success || !Array.isArray(res.data)) {
        throw new Error(res.message || t('We could not load channels.'))
      }
      return res.data
    },
    staleTime: 0,
    retry: false,
  })

  // Default-select every group on first load; refresh keeps existing choices
  // but drops ones that no longer have an enabled channel.
  useEffect(() => {
    const available = groupsQuery.data ?? []
    if (available.length === 0) {
      setSelectedGroups([])
      return
    }
    setSelectedGroups((prev) => {
      const valid = available.map((g) => g.group)
      const kept = prev.filter((g) => valid.includes(g))
      return prev.length === 0 || kept.length === 0 ? valid : kept
    })
  }, [groupsQuery.data])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: GROUPS_KEY })
  }

  const runMutation = useMutation({
    mutationFn: (groups: string[]) => runDegradationTests(groups),
    onSuccess: (res) => {
      setRunConflict(false)
      setRunMessage(
        res.success
          ? t('Probe finished. Review the new results below, then publish the ones you approve.')
          : res.message || t('Probe failed.')
      )
      refresh()
    },
    onError: (err: unknown) => {
      // 409 means a probe is still running on the server (e.g. triggered from
      // another tab). Show a friendly notice instead of a scary raw error.
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } } }
      if (axiosErr?.response?.status === 409) {
        setRunConflict(true)
        setRunMessage(t('A probe is already running. Wait for it to finish, then try again.'))
        refresh()
        return
      }
      setRunConflict(false)
      setRunMessage(err instanceof Error ? err.message : t('Probe failed.'))
    },
  })

  const publishMutation = useMutation({
    mutationFn: (id: number) => publishDegradationTest(id),
    onSuccess: refresh,
  })
  const discardMutation = useMutation({
    mutationFn: (id: number) => discardDegradationTest(id),
    onSuccess: refresh,
  })

  if (role < ROLE.ADMIN) {
    return (
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('Degradation Detection')}</SectionPageLayout.Title>
        <SectionPageLayout.Content>
          <p className='text-muted-foreground text-sm'>{t('Admin access required')}</p>
        </SectionPageLayout.Content>
      </SectionPageLayout>
    )
  }

  const rows: AdminDegradationTest[] = listQuery.data ?? []
  const pending = rows.filter((r) => r.pending)
  const published = rows.filter((r) => !r.pending)
  const busy = runMutation.isPending
  const groups: ProbeGroup[] = groupsQuery.data ?? []

  const toggleGroup = (group: string, checked: boolean) => {
    setSelectedGroups((prev) =>
      checked ? [...prev, group] : prev.filter((g) => g !== group)
    )
  }

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>
        <span className='inline-flex min-w-0 items-center gap-2'>
          <span className='truncate'>{t('Degradation Detection')}</span>
          <Badge variant='outline' className='shrink-0'>
            Admin
          </Badge>
        </span>
      </SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <div className='space-y-5'>
          <section className='bg-card overflow-hidden rounded-lg border shadow-xs'>
            <div className='flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
              <div className='min-w-0'>
                <h3 className='text-sm font-semibold'>{t('Manual degradation probe')}</h3>
                <p className='text-muted-foreground mt-0.5 text-xs'>
                  {t('Select one or more channels below, then run the probe. Results stay hidden until you publish them.')}
                </p>
              </div>
              <div className='flex shrink-0 items-center gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  onClick={refresh}
                  disabled={listQuery.isFetching || groupsQuery.isFetching}
                >
                  <RefreshCw className='size-3.5' aria-hidden='true' />
                  {t('Refresh')}
                </Button>
                <Button
                  type='button'
                  size='sm'
                  onClick={() => {
                    setRunMessage(null)
                    runMutation.mutate(selectedGroups)
                  }}
                  disabled={busy || selectedGroups.length === 0}
                >
                  <Play className='size-3.5' aria-hidden='true' />
                  {busy ? t('Running probe...') : t('Run probe')}
                </Button>
              </div>
            </div>

            {/* Dynamic channel/group selection */}
            <div className='border-b px-4 py-3 sm:px-5'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='text-muted-foreground text-xs font-medium'>
                  {t('Channels to probe')} ({selectedGroups.length}/{groups.length})
                </span>
                <div className='flex gap-3'>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline'
                    onClick={() => setSelectedGroups(groups.map((g) => g.group))}
                    disabled={groups.length === 0 || busy}
                  >
                    {t('Select all')}
                  </button>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline'
                    onClick={() => setSelectedGroups([])}
                    disabled={selectedGroups.length === 0 || busy}
                  >
                    {t('Clear')}
                  </button>
                </div>
              </div>
              {groupsQuery.isLoading ? (
                <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className='h-9 w-full rounded-md' />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className='text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-xs'>
                  {t('No channels available. Enable a channel first, then refresh.')}
                </div>
              ) : (
                <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
                  {groups.map((g) => (
                    <Label
                      key={g.group}
                      className='hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs font-normal'
                    >
                      <Checkbox
                        checked={selectedGroups.includes(g.group)}
                        onCheckedChange={(checked) => toggleGroup(g.group, checked === true)}
                        disabled={busy}
                      />
                      <span className='min-w-0 flex-1 truncate'>{g.group}</span>
                      <Badge variant='outline' className='shrink-0 text-[10px]'>
                        {g.channel_count} {t('channels')}
                      </Badge>
                      {g.published_count > 0 && (
                        <span className='text-muted-foreground shrink-0 text-[10px]' title={t('Published')}>
                          ✓{g.published_count}
                        </span>
                      )}
                      {g.pending_count > 0 && (
                        <span className='shrink-0 text-[10px] text-amber-600' title={t('Pending review')}>
                          ●{g.pending_count}
                        </span>
                      )}
                    </Label>
                  ))}
                </div>
              )}
            </div>

            {runMessage && (
              <div className={`border-b px-4 py-2.5 text-xs sm:px-5 ${runConflict ? 'text-amber-600' : ''}`}>
                {runMessage}
              </div>
            )}
            {runMutation.isError && !runConflict && (
              <div className='text-destructive border-b px-4 py-2.5 text-xs sm:px-5'>
                {runMutation.error instanceof Error
                  ? runMutation.error.message
                  : t('Probe failed.')}
              </div>
            )}
          </section>

          <ResultSection
            title={t('Pending review')}
            description={t('Newly generated results. Publish only the ones that look correct.')}
            rows={pending}
            loading={listQuery.isLoading}
            pending
            onPublish={(id) => publishMutation.mutate(id)}
            onDiscard={(id) => discardMutation.mutate(id)}
            actionBusy={publishMutation.isPending || discardMutation.isPending}
          />

          <ResultSection
            title={t('Published')}
            description={t('These results are visible on the public pricing page.')}
            rows={published}
            loading={listQuery.isLoading}
          />
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}

type ResultSectionProps = {
  title: string
  description: string
  rows: AdminDegradationTest[]
  loading: boolean
  pending?: boolean
  onPublish?: (id: number) => void
  onDiscard?: (id: number) => void
  actionBusy?: boolean
}

function ResultSection(props: ResultSectionProps) {
  const { t } = useTranslation()
  return (
    <section className='bg-card overflow-hidden rounded-lg border shadow-xs'>
      <div className='flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5'>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold'>{props.title}</h3>
          <p className='text-muted-foreground mt-0.5 text-xs'>{props.description}</p>
        </div>
        <Badge variant='outline' className='shrink-0'>
          {props.rows.length}
        </Badge>
      </div>
      <div className='p-4 sm:p-5'>
        {props.loading ? (
          <div className='grid gap-4 md:grid-cols-2'>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className='h-64 w-full rounded-md' />
            ))}
          </div>
        ) : props.rows.length === 0 ? (
          <div className='text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm'>
            {t('No results')}
          </div>
        ) : (
          <div className='grid gap-4 md:grid-cols-2'>
            {props.rows.map((row) => (
              <DegradationResultCard
                key={row.id}
                row={row}
                pending={props.pending}
                onPublish={props.onPublish}
                onDiscard={props.onDiscard}
                actionBusy={props.actionBusy}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

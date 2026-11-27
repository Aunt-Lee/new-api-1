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
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  discardDegradationTest,
  getProbeTaskStatus,
  listDegradationTests,
  listProbeGroups,
  publishDegradationTest,
  runDegradationTests,
} from './api'
import { DegradationResultCard } from './components/result-card'
import type {
  AdminDegradationTest,
  ProbeGroup,
  ProbeTarget,
  ProbeTaskStatus,
} from './types'

const QUERY_KEY = ['degradation-detection', 'list']
const GROUPS_KEY = ['degradation-detection', 'groups']
const TASK_KEY = ['degradation-detection', 'task']

export function DegradationDetection() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const role = useAuthStore((state) => state.auth.user?.role ?? ROLE.GUEST)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [runConflict, setRunConflict] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  // group -> selected model names. Nothing is selected by default: a run can
  // take minutes, so the admin must deliberately choose targets first.
  const [selection, setSelection] = useState<Record<string, string[]>>({})
  const [openGroups, setOpenGroups] = useState<string[]>([])

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

  const groups: ProbeGroup[] = groupsQuery.data ?? []

  // Keep the admin's choices in sync with the channel configuration: drop
  // groups/models that no longer exist. Never default-select — an accidental
  // "Run probe" on all 55 models would take a very long time.
  useEffect(() => {
    if (groups.length === 0 || groupsQuery.isLoading) return
    setSelection((prev) => {
      const next: Record<string, string[]> = {}
      for (const g of groups) {
        const valid = new Set(g.models)
        next[g.group] = (prev[g.group] ?? []).filter((m) => valid.has(m))
      }
      return next
    })
  }, [groupsQuery.data, groupsQuery.isLoading])

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    void queryClient.invalidateQueries({ queryKey: GROUPS_KEY })
    void queryClient.invalidateQueries({ queryKey: TASK_KEY })
  }

  // Poll the background task while it is running. Results are refreshed once
  // when the task reaches a terminal state.
  const taskQuery = useQuery({
    queryKey: TASK_KEY,
    queryFn: async (): Promise<ProbeTaskStatus> => {
      const res = await getProbeTaskStatus()
      if (!res.success) throw new Error(res.message || t('Could not read task status.'))
      return res.data
    },
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2500 : false),
    staleTime: 0,
    retry: false,
  })

  const task = taskQuery.data
  const taskRunning = task?.status === 'running'
  const lastDoneId = useRef<string | null>(null)
  useEffect(() => {
    if (!task) return
    if (task.status === 'done' && task.task_id && lastDoneId.current !== task.task_id) {
      lastDoneId.current = task.task_id
      setRunConflict(false)
      setRunMessage(
        t('Probe finished: {{succeeded}} succeeded, {{failed}} failed. Review the results below.', {
          succeeded: task.succeeded,
          failed: task.failed,
        })
      )
      refresh()
    }
  }, [task])

  const runMutation = useMutation({
    mutationFn: (targets: ProbeTarget[]) => runDegradationTests(targets),
    onSuccess: (res) => {
      setRunConflict(false)
      if (res.success && res.data?.status === 'running') {
        setRunMessage(
          t('Probe started ({{total}} targets). This runs in the background — you can wait here or come back later.', {
            total: res.data.total,
          })
        )
      } else {
        setRunMessage(res.message || t('Probe failed.'))
      }
      void queryClient.invalidateQueries({ queryKey: TASK_KEY })
    },
    onError: (err: unknown) => {
      const axiosErr = err as {
        response?: { status?: number; data?: { message?: string; retry_after?: number } }
      }
      if (axiosErr?.response?.status === 409) {
        setRunConflict(true)
        setRunMessage(
          t('A probe is already running. Try again in about {{seconds}} seconds.', {
            seconds: axiosErr.response.data?.retry_after ?? 30,
          })
        )
        void queryClient.invalidateQueries({ queryKey: TASK_KEY })
        return
      }
      setRunConflict(false)
      setRunMessage(err instanceof Error ? err.message : t('Probe failed.'))
    },
  })

  const publishMutation = useMutation({
    mutationFn: (id: number) => publishDegradationTest(id),
    onSuccess: () => {
      setActionMessage(null)
      refresh()
    },
    onError: (err: unknown) => {
      setActionMessage(err instanceof Error ? err.message : t('Could not publish result.'))
    },
  })
  const discardMutation = useMutation({
    mutationFn: (id: number) => discardDegradationTest(id),
    onSuccess: () => {
      setActionMessage(null)
      refresh()
    },
    onError: (err: unknown) => {
      setActionMessage(err instanceof Error ? err.message : t('Could not discard result.'))
    },
  })

  // Derive the flat target list from the current selection.
  const targets = useMemo<ProbeTarget[]>(() => {
    const result: ProbeTarget[] = []
    for (const [group, models] of Object.entries(selection)) {
      for (const model of models) result.push({ group, model })
    }
    return result
  }, [selection])

  const totalModels = useMemo(
    () => groups.reduce((sum, g) => sum + g.models.length, 0),
    [groups]
  )

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
  const busy = runMutation.isPending || taskRunning

  const selectedModelCount = (group: ProbeGroup) => selection[group.group]?.length ?? 0
  const isGroupFullySelected = (group: ProbeGroup) =>
    group.models.length > 0 && selectedModelCount(group) === group.models.length

  const toggleModel = (group: string, model: string, checked: boolean) => {
    setSelection((prev) => {
      const current = prev[group] ?? []
      const next = checked
        ? [...new Set([...current, model])]
        : current.filter((m) => m !== model)
      return { ...prev, [group]: next }
    })
  }

  const setGroupModels = (group: ProbeGroup, checked: boolean) => {
    setSelection((prev) => ({
      ...prev,
      [group.group]: checked ? [...group.models] : [],
    }))
  }

  const selectAll = () => {
    const next: Record<string, string[]> = {}
    for (const g of groups) next[g.group] = [...g.models]
    setSelection(next)
  }

  const clearAll = () => {
    const next: Record<string, string[]> = {}
    for (const g of groups) next[g.group] = []
    setSelection(next)
  }

  return (
    // NOTE: no `fixedContent`. The content area must scroll so admins can see
    // every result card; `fixedContent` maps to overflow-hidden and clips them.
    <SectionPageLayout>
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
                  {t('Select a group, then pick the models to probe. Each group-model pair is checked independently. Results stay hidden until you publish them.')}
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
                    runMutation.mutate(targets)
                  }}
                  disabled={busy || targets.length === 0}
                >
                  <Play className='size-3.5' aria-hidden='true' />
                  {taskRunning && task
                    ? t('Running {{done}}/{{total}}', { done: task.completed, total: task.total })
                    : t('Run probe')}
                </Button>
              </div>
            </div>

            {/* Dynamic group -> model selection */}
            <div className='border-b px-4 py-3 sm:px-5'>
              <div className='mb-2 flex items-center justify-between gap-2'>
                <span className='text-muted-foreground text-xs font-medium'>
                  {t('Models to probe')} ({targets.length}/{totalModels})
                </span>
                <div className='flex gap-3'>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline'
                    onClick={selectAll}
                    disabled={groups.length === 0 || busy}
                  >
                    {t('Select all')}
                  </button>
                  <button
                    type='button'
                    className='text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline'
                    onClick={clearAll}
                    disabled={targets.length === 0 || busy}
                  >
                    {t('Clear')}
                  </button>
                </div>
              </div>

              {groupsQuery.isLoading ? (
                <div className='space-y-2'>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className='h-10 w-full rounded-md' />
                  ))}
                </div>
              ) : groups.length === 0 ? (
                <div className='text-muted-foreground rounded-md border border-dashed px-4 py-6 text-center text-xs'>
                  {t('No channels available. Enable a channel first, then refresh.')}
                </div>
              ) : (
                <Accordion
                  value={openGroups}
                  onValueChange={setOpenGroups}
                  className='w-full'
                >
                  {groups.map((g) => {
                    const count = selectedModelCount(g)
                    const fully = isGroupFullySelected(g)
                    return (
                      <AccordionItem key={g.group} value={g.group} className='border-b last:border-b-0'>
                        <div className='flex items-center gap-2 py-1'>
                          <Checkbox
                            checked={fully}
                            indeterminate={!fully && count > 0}
                            onCheckedChange={(checked) => setGroupModels(g, checked === true)}
                            disabled={busy || g.models.length === 0}
                            aria-label={g.group}
                          />
                          <AccordionTrigger className='hover:no-underline py-2'>
                            <span className='flex min-w-0 flex-wrap items-center gap-2'>
                              <span className='truncate text-xs font-medium'>{g.group}</span>
                              <Badge variant='outline' className='shrink-0 text-[10px]'>
                                {count}/{g.models.length} {t('models')}
                              </Badge>
                              <span className='text-muted-foreground shrink-0 text-[10px]'>
                                {g.channel_count} {t('channels')}
                              </span>
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
                            </span>
                          </AccordionTrigger>
                        </div>
                        <AccordionContent className='pb-3 pl-6'>
                          {g.models.length === 0 ? (
                            <p className='text-muted-foreground py-1 text-xs'>
                              {t('No enabled models in this group.')}
                            </p>
                          ) : (
                            <div className='grid gap-1.5 pt-1 sm:grid-cols-2 lg:grid-cols-3'>
                              {g.models.map((model) => (
                                <Label
                                  key={model}
                                  className={cn(
                                    'hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs font-normal'
                                  )}
                                >
                                  <Checkbox
                                    checked={(selection[g.group] ?? []).includes(model)}
                                    onCheckedChange={(checked) => toggleModel(g.group, model, checked === true)}
                                    disabled={busy}
                                  />
                                  <span className='min-w-0 flex-1 truncate font-mono text-[11px]'>
                                    {model}
                                  </span>
                                </Label>
                              ))}
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    )
                  })}
                </Accordion>
              )}
            </div>

            {taskRunning && task && task.total > 0 && (
              <div className='border-b px-4 py-2.5 sm:px-5'>
                <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
                  <div
                    className='bg-primary h-full rounded-full transition-all'
                    style={{ width: `${Math.round((task.completed / task.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
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
            {actionMessage && (
              <div className='text-destructive border-b px-4 py-2.5 text-xs sm:px-5'>
                {actionMessage}
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
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className='h-64 w-full rounded-md' />
            ))}
          </div>
        ) : props.rows.length === 0 ? (
          <div className='text-muted-foreground rounded-md border border-dashed px-4 py-10 text-center text-sm'>
            {t('No results')}
          </div>
        ) : (
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-3'>
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

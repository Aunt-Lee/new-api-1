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
import { Copy } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { SectionPageLayout } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { useChatPresets } from '@/features/chat/hooks/use-chat-presets'
import { useStatus } from '@/hooks/use-status'
import { copyToClipboard } from '@/lib/copy-to-clipboard'

import { ApiKeysDialogs } from './components/api-keys-dialogs'
import { ApiKeysPrimaryButtons } from './components/api-keys-primary-buttons'
import { ApiKeysProvider } from './components/api-keys-provider'
import { ApiKeysTable } from './components/api-keys-table'

function normalizeUrl(base: string) {
  return base.replace(/\/+$/, '')
}

function buildImageApiUrl(base: string) {
  if (!base) return ''

  try {
    const url = new URL(base)
    if (!url.hostname.startsWith('image.')) {
      url.hostname = `image.${url.hostname}`
    }
    return normalizeUrl(url.toString())
  } catch {
    return normalizeUrl(base)
  }
}

function getImageApiUrl(status: ReturnType<typeof useStatus>['status']) {
  const apiInfo = (status?.api_info ?? status?.data?.api_info) as
    | Array<{ description?: string; route?: string; url?: string }>
    | undefined

  const imageInfo = apiInfo?.find((item) => {
    const text = `${item.description ?? ''} ${item.route ?? ''}`.toLowerCase()
    return (
      text.includes('图像') || text.includes('生图') || text.includes('image')
    )
  })

  if (imageInfo?.url) return normalizeUrl(imageInfo.url)
  return ''
}

function ApiUrlRow(props: { label: string; value: string }) {
  const { t } = useTranslation()

  const handleCopy = async () => {
    const ok = await copyToClipboard(props.value)
    if (ok) toast.success(t('Copied'))
  }

  return (
    <div className='bg-muted/30 flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1'>
      <div className='text-muted-foreground shrink-0 text-xs font-medium'>
        {props.label}
      </div>
      <code className='min-w-0 truncate font-mono text-xs'>
        {props.value}
      </code>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        className='shrink-0'
        onClick={handleCopy}
        aria-label={t('Copy')}
      >
        <Copy className='size-3.5' />
      </Button>
    </div>
  )
}

function ApiUrlDisplay() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { serverAddress } = useChatPresets()
  const baseUrl = useMemo(() => {
    const base =
      serverAddress ||
      (typeof window !== 'undefined' ? window.location.origin : '')
    return normalizeUrl(base)
  }, [serverAddress])
  const imageApiUrl = useMemo(
    () => getImageApiUrl(status) || buildImageApiUrl(serverAddress),
    [serverAddress, status]
  )

  return (
    <div className='mb-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-center'>
      <ApiUrlRow label='BaseUrl' value={baseUrl} />
      <div className='bg-border hidden h-5 w-px sm:block' />
      <ApiUrlRow label={t('Image API URL')} value={imageApiUrl} />
    </div>
  )
}

export function ApiKeys() {
  const { t } = useTranslation()
  return (
    <ApiKeysProvider>
      <SectionPageLayout fixedContent>
        <SectionPageLayout.Title>{t('API Keys')}</SectionPageLayout.Title>
        <SectionPageLayout.Actions>
          <ApiKeysPrimaryButtons />
        </SectionPageLayout.Actions>
        <SectionPageLayout.Content>
          <div className='flex h-full min-h-0 flex-col'>
            <ApiUrlDisplay />
            <div className='min-h-0 flex-1'>
              <ApiKeysTable />
            </div>
          </div>
        </SectionPageLayout.Content>
      </SectionPageLayout>

      <ApiKeysDialogs />
    </ApiKeysProvider>
  )
}

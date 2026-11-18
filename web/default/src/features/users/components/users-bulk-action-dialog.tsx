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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'

import { deleteUser, manageUser } from '../api'
import type { User } from '../types'
import { useUsers } from './users-provider'

export type BulkUserAction = 'delete' | 'disable' | 'enable'

interface UsersBulkActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: BulkUserAction
  users: User[]
  skippedCount: number
  onSuccess: () => void
}

const ACTION_LABEL_KEYS: Record<BulkUserAction, string> = {
  delete: 'Delete',
  disable: 'Disable',
  enable: 'Enable',
}

const ACTION_TITLE_KEYS: Record<BulkUserAction, string> = {
  delete: 'Delete selected users',
  disable: 'Disable selected users',
  enable: 'Enable selected users',
}

const ACTION_CONFIRM_KEYS: Record<BulkUserAction, string> = {
  delete: 'Are you sure you want to delete {{count}} user(s)?',
  disable: 'Are you sure you want to disable {{count}} user(s)?',
  enable: 'Are you sure you want to enable {{count}} user(s)?',
}

const ACTION_SUCCESS_KEYS: Record<BulkUserAction, string> = {
  delete: 'Successfully deleted {{count}} user(s)',
  disable: 'Successfully disabled {{count}} user(s)',
  enable: 'Successfully enabled {{count}} user(s)',
}

const ACTION_FAILURE_KEYS: Record<BulkUserAction, string> = {
  delete: 'Failed to delete {{count}} user(s)',
  disable: 'Failed to disable {{count}} user(s)',
  enable: 'Failed to enable {{count}} user(s)',
}

/**
 * Confirmation dialog that applies one management action to every target user.
 * Root users are filtered out by the caller and are never sent to the API.
 */
export function UsersBulkActionDialog(props: UsersBulkActionDialogProps) {
  const { t } = useTranslation()
  const { triggerRefresh } = useUsers()
  const [isProcessing, setIsProcessing] = useState(false)

  const action = props.action
  const actionLabel = t(ACTION_LABEL_KEYS[action])

  const handleConfirm = async () => {
    if (props.users.length === 0) return

    setIsProcessing(true)
    let succeeded = 0

    for (const user of props.users) {
      try {
        // Delete uses its own endpoint; status changes go through manage.
        const result =
          action === 'delete'
            ? await deleteUser(user.id)
            : await manageUser(user.id, action)
        if (result.success) succeeded += 1
      } catch {
        // Continue with the remaining users and report failures in aggregate.
      }
    }

    const failed = props.users.length - succeeded
    if (succeeded > 0) {
      toast.success(
        t(ACTION_SUCCESS_KEYS[action], {
          count: succeeded,
        })
      )
      props.onSuccess()
      triggerRefresh()
      props.onOpenChange(false)
    }
    if (failed > 0) {
      toast.error(t(ACTION_FAILURE_KEYS[action], { count: failed }))
    }

    setIsProcessing(false)
  }

  return (
    <ConfirmDialog
      destructive={action === 'delete'}
      open={props.open}
      onOpenChange={props.onOpenChange}
      handleConfirm={handleConfirm}
      isLoading={isProcessing}
      className='max-w-md'
      title={t(ACTION_TITLE_KEYS[action])}
      desc={
        <>
          {t(ACTION_CONFIRM_KEYS[action], {
            count: props.users.length,
          })}{' '}
          {action === 'delete' && t('This action cannot be undone.')}
          {props.skippedCount > 0 && (
            <>
              <br />
              {t('Root users are skipped in bulk operations')}
            </>
          )}
        </>
      }
      confirmText={actionLabel}
    />
  )
}

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
import { api, type ApiRequestConfig } from '@/lib/api'

import type {
  AdminDegradationListResponse,
  DegradationActionResponse,
  DegradationRunResponse,
} from './types'

// Admin management handles business errors locally instead of via global toast.
const actionConfig: ApiRequestConfig = {
  skipBusinessError: true,
  skipErrorHandler: true,
}

// List recent probe results across groups, including pending (unreviewed) ones.
export async function listDegradationTests(): Promise<AdminDegradationListResponse> {
  const res = await api.get<AdminDegradationListResponse>(
    '/api/pelican-test/admin/list',
    actionConfig
  )
  return res.data
}

// Trigger one manual probe per target group. Results are stored as pending.
export async function runDegradationTests(): Promise<DegradationRunResponse> {
  const res = await api.post<DegradationRunResponse>(
    '/api/pelican-test/run',
    {},
    actionConfig
  )
  return res.data
}

// Publish a pending result so it appears on the public pricing page.
export async function publishDegradationTest(id: number): Promise<DegradationActionResponse> {
  const res = await api.post<DegradationActionResponse>(
    `/api/pelican-test/admin/publish/${id}`,
    {},
    actionConfig
  )
  return res.data
}

// Permanently discard a pending result the admin rejects.
export async function discardDegradationTest(id: number): Promise<DegradationActionResponse> {
  const res = await api.post<DegradationActionResponse>(
    `/api/pelican-test/admin/discard/${id}`,
    {},
    actionConfig
  )
  return res.data
}

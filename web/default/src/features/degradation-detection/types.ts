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

// A selectable probe target: a group with at least one enabled channel, plus
// the distinct enabled models in that group. Admins pick one or more models
// under a group; the group still decides which channel pool serves the probe.
export interface ProbeGroup {
  group: string
  channel_count: number
  published_count: number
  pending_count: number
  models: string[]
}

export interface ProbeGroupsResponse {
  success: boolean
  message?: string
  data: ProbeGroup[]
}

// One (group, model) pair sent to the run endpoint.
export interface ProbeTarget {
  group: string
  model: string
}

// One degradation-probe result as seen from the admin review page.
export interface AdminDegradationTest {
  id: number
  group: string
  model_name: string
  content?: string
  status: string
  fail_reason?: string
  pending: boolean
  created_at: number
}

export interface AdminDegradationListResponse {
  success: boolean
  message?: string
  data: AdminDegradationTest[]
}

// Snapshot of the background probe task returned by /run (202) and
// /admin/run/status. Status: idle | running | done.
export interface ProbeTaskStatus {
  task_id: string
  status: 'idle' | 'running' | 'done'
  total: number
  completed: number
  succeeded: number
  failed: number
  started_at: number
  finished_at?: number
}

export interface DegradationRunResponse {
  success: boolean
  message?: string
  data?: ProbeTaskStatus
  retry_after?: number
}

export interface ProbeTaskStatusResponse {
  success: boolean
  message?: string
  data: ProbeTaskStatus
}

export interface DegradationActionResponse {
  success: boolean
  message?: string
}

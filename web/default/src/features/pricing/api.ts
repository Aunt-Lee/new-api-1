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
import { api } from '@/lib/api'

import type { PricingData } from './types'

// ----------------------------------------------------------------------------
// Pricing APIs
// ----------------------------------------------------------------------------

// Get model pricing data
export async function getPricing(): Promise<PricingData> {
  const res = await api.get('/api/pricing')
  return res.data
}

// ----------------------------------------------------------------------------
// Pelican probe APIs
// ----------------------------------------------------------------------------

export interface PelicanTestResult {
  group: string
  model_name: string
  content?: string
  status: string
  created_at: number
}

// Recent "pelican riding a bicycle" probe results for each group, newest first.
export async function getPelicanTests(): Promise<PelicanTestResult[]> {
  const res = await api.get<{
    success: boolean
    data: PelicanTestResult[]
  }>('/api/pelican-test')
  return res.data?.data ?? []
}

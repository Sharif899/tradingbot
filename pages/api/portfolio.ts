/**
 * pages/api/portfolio.ts
 * GET /api/portfolio — returns current portfolio state
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { getPortfolioState } from '@/lib/exchange'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  try {
    const state = await getPortfolioState()
    return res.status(200).json(state)
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

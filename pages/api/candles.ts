/**
 * pages/api/candles.ts
 * GET /api/candles?symbol=BTC/USDT:USDT&timeframe=1h&limit=200
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchCandles } from '@/lib/exchange'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const symbol = (req.query.symbol as string) || 'BTC/USDT:USDT'
  const timeframe = (req.query.timeframe as string) || '1h'
  const limit = parseInt((req.query.limit as string) || '200')

  try {
    const candles = await fetchCandles(symbol, timeframe, limit)
    // Cache for 60 seconds
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate')
    return res.status(200).json(candles)
  } catch (error: unknown) {
    return res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
}

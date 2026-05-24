/**
 * pages/api/trade/execute.ts
 * POST /api/trade/execute
 * Body: { symbol, side, confidence, entryPrice, stopLoss, takeProfit, leverage }
 *
 * Final execution endpoint. Runs risk check one more time before sending to exchange.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { executeTrade, getPortfolioState } from '@/lib/exchange'
import { validateTrade, DEFAULT_RISK_CONFIG } from '@/lib/riskEngine'
import { alerts } from '@/lib/alerts'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Simple auth check — use a secret header for dashboard requests
  const secret = req.headers['x-dashboard-secret']
  if (secret !== process.env.DASHBOARD_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const tradeSignal = req.body
    const portfolio = await getPortfolioState()

    // Final risk check (never skip this, even if UI already checked)
    const validation = validateTrade(tradeSignal, portfolio, DEFAULT_RISK_CONFIG)
    if (!validation.approved) {
      await alerts.tradeRejected(tradeSignal.symbol, validation.reason || 'Risk check failed at execution')
      return res.status(400).json({ error: validation.reason, warnings: validation.warnings })
    }

    const positionSize = validation.adjustedSize!
    const result = await executeTrade(tradeSignal, positionSize)

    await alerts.tradeOpened(
      tradeSignal.symbol,
      tradeSignal.side,
      tradeSignal.entryPrice,
      tradeSignal.stopLoss,
      tradeSignal.takeProfit,
      positionSize,
      tradeSignal.confidence,
      result.mode
    )

    return res.status(200).json({
      success: true,
      orderId: result.orderId,
      mode: result.mode,
      positionSize,
      warnings: validation.warnings,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await alerts.systemError(`/api/trade/execute error: ${message}`)
    return res.status(500).json({ error: message })
  }
}

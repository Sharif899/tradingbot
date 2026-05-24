/**
 * pages/api/signal.ts
 * GET /api/signal?symbol=BTC/USDT:USDT&timeframe=1h
 *
 * Fetches live market data, runs technical analysis,
 * asks Claude for a trade decision, runs it through risk management.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchCandles, fetchFundingRate, getPortfolioState } from '@/lib/exchange'
import { generateSignal } from '@/lib/signalEngine'
import { validateTrade, calculateATRStopLoss, DEFAULT_RISK_CONFIG } from '@/lib/riskEngine'
import { alerts } from '@/lib/alerts'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const symbol = (req.query.symbol as string) || 'BTC/USDT:USDT'
  const timeframe = (req.query.timeframe as string) || '1h'

  try {
    // 1. Fetch market data
    const [candles, fundingRate, portfolio] = await Promise.all([
      fetchCandles(symbol, timeframe, 200),
      fetchFundingRate(symbol),
      getPortfolioState(),
    ])

    // 2. Build market context
    const ctx = {
      symbol,
      candles,
      fundingRate,
      openInterest: 0,      // Fetch from exchange if needed
      oiChange24h: 0,
      longShortRatio: 1.0,
    }

    // 3. Get AI signal
    const signal = await generateSignal(ctx)

    if (signal.action === 'wait') {
      return res.status(200).json({ signal, validation: null, reason: 'AI recommends waiting' })
    }

    // 4. Calculate ATR-based stops
    const lastClose = candles[candles.length - 1].close
    const { stopLoss, takeProfit, atr } = calculateATRStopLoss(
      candles, lastClose, signal.action, 2.0
    )

    // 5. Build trade signal
    const tradeSignal = {
      symbol,
      side: signal.action as 'long' | 'short',
      confidence: signal.confidence,
      entryPrice: lastClose,
      stopLoss,
      takeProfit,
      leverage: signal.suggestedLeverage,
    }

    // 6. Risk validation gate
    const validation = validateTrade(tradeSignal, portfolio, DEFAULT_RISK_CONFIG)

    if (!validation.approved) {
      await alerts.tradeRejected(symbol, validation.reason || 'Risk check failed')
    }

    return res.status(200).json({
      signal,
      tradeSignal,
      validation,
      atr,
      portfolioSnapshot: {
        totalCapital: portfolio.totalCapital,
        availableCapital: portfolio.availableCapital,
        openPositions: portfolio.openPositions.length,
        dailyPnlPct: portfolio.dailyPnlPct,
        mode: portfolio.mode,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await alerts.systemError(`/api/signal error: ${message}`)
    return res.status(500).json({ error: message })
  }
}

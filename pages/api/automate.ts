/**
 * pages/api/automate.ts
 * GET /api/automate — Vercel Cron Job endpoint
 *
 * Add this to vercel.json crons to run automatically:
 * Every 1 hour: scans top coins, generates signals, executes if approved
 *
 * Vercel cron schedule (set in vercel.json):
 *   "0 * * * *"  = every hour
 *   "*/30 * * * *" = every 30 minutes (needs Pro plan)
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchCandles, fetchFundingRate, getPortfolioState, executeTrade } from '@/lib/exchange'
import { generateSignal, buildIndicators } from '@/lib/signalEngine'
import { validateTrade, calculateATRStopLoss, DEFAULT_RISK_CONFIG } from '@/lib/riskEngine'
import { alerts } from '@/lib/alerts'
import { TIER1_COINS, TIER2_COINS } from '@/lib/coins'

const TIMEFRAME = process.env.AUTO_TIMEFRAME || '1h'
const MIN_CONFIDENCE = parseFloat(process.env.AUTO_MIN_CONFIDENCE || '0.70')
const MAX_SIGNALS_PER_RUN = parseInt(process.env.AUTO_MAX_SIGNALS || '2')
// Scan tier 1 first, then a few tier 2 — keeps API calls low
const AUTO_WATCHLIST = [
  ...TIER1_COINS,
  ...TIER2_COINS.slice(0, 10), // top 10 tier 2 coins
]

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Allow GET (cron) or POST (manual trigger from dashboard)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Basic auth for manual POST from dashboard
  if (req.method === 'POST') {
    const secret = req.headers['x-dashboard-secret']
    if (secret !== process.env.DASHBOARD_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const runId = `run_${Date.now()}`
  const log: string[] = []
  const executed: string[] = []
  const rejected: string[] = []

  log.push(`[${runId}] Auto-trading scan started — ${AUTO_WATCHLIST.length} coins, ${TIMEFRAME} timeframe`)

  try {
    const portfolio = await getPortfolioState()

    // Circuit breaker check
    if (portfolio.dailyPnlPct <= -DEFAULT_RISK_CONFIG.maxDailyDrawdown) {
      const msg = `Circuit breaker active — daily loss ${(portfolio.dailyPnlPct * 100).toFixed(2)}%. Skipping run.`
      log.push(msg)
      await alerts.circuitBreaker(portfolio.dailyPnlPct)
      return res.status(200).json({ runId, skipped: true, reason: msg, log })
    }

    // Max positions check
    if (portfolio.openPositions.length >= DEFAULT_RISK_CONFIG.maxOpenPositions) {
      const msg = `Max positions (${DEFAULT_RISK_CONFIG.maxOpenPositions}) reached. Skipping run.`
      log.push(msg)
      return res.status(200).json({ runId, skipped: true, reason: msg, log })
    }

    let signalsExecuted = 0

    // Quick pre-screen using technical indicators only (no AI call)
    // This avoids burning Anthropic credits on coins with no setup
    const candidates: string[] = []

    for (const symbol of AUTO_WATCHLIST) {
      if (candidates.length >= MAX_SIGNALS_PER_RUN * 3) break // enough candidates

      try {
        const candles = await fetchCandles(symbol, TIMEFRAME, 100)
        if (candles.length < 50) continue

        const indicators = buildIndicators({
          symbol, candles, fundingRate: 0,
          openInterest: 0, oiChange24h: 0, longShortRatio: 1
        })

        // Only consider coins with a clear setup
        const hasSetup =
          (indicators.rsi < 35 && indicators.trend !== 'down') ||   // oversold bounce
          (indicators.rsi > 65 && indicators.trend !== 'up') ||     // overbought short
          (indicators.macd.histogram > 0 && indicators.trend === 'up') ||   // bullish momentum
          (indicators.macd.histogram < 0 && indicators.trend === 'down')    // bearish momentum

        if (hasSetup) {
          candidates.push(symbol)
          log.push(`Pre-screen pass: ${symbol} RSI=${indicators.rsi.toFixed(1)} trend=${indicators.trend}`)
        }

        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 200))
      } catch {
        // Skip failed symbols silently
      }
    }

    log.push(`Pre-screen complete: ${candidates.length} candidates from ${AUTO_WATCHLIST.length} coins`)

    // Now run full AI analysis on candidates only
    for (const symbol of candidates) {
      if (signalsExecuted >= MAX_SIGNALS_PER_RUN) break

      try {
        log.push(`AI analysing ${symbol}...`)

        const [candles, fundingRate] = await Promise.all([
          fetchCandles(symbol, TIMEFRAME, 200),
          fetchFundingRate(symbol),
        ])

        const signal = await generateSignal({
          symbol, candles, fundingRate,
          openInterest: 0, oiChange24h: 0, longShortRatio: 1
        })

        log.push(`${symbol}: ${signal.action.toUpperCase()} confidence=${(signal.confidence * 100).toFixed(1)}%`)

        if (signal.action === 'wait') {
          rejected.push(`${symbol}: AI says wait`)
          continue
        }

        // Require higher confidence for auto-trading
        if (signal.confidence < MIN_CONFIDENCE) {
          rejected.push(`${symbol}: confidence ${(signal.confidence * 100).toFixed(1)}% < ${(MIN_CONFIDENCE * 100).toFixed(0)}% minimum`)
          log.push(`${symbol}: confidence too low, skipping`)
          continue
        }

        const lastClose = candles[candles.length - 1].close
        const { stopLoss, takeProfit } = calculateATRStopLoss(
          candles, lastClose, signal.action as 'long' | 'short', 2.0
        )

        const tradeSignal = {
          symbol,
          side: signal.action as 'long' | 'short',
          confidence: signal.confidence,
          entryPrice: lastClose,
          stopLoss,
          takeProfit,
          leverage: Math.min(signal.suggestedLeverage, DEFAULT_RISK_CONFIG.maxLeverage),
        }

        // Refresh portfolio state before each trade
        const freshPortfolio = await getPortfolioState()
        const validation = validateTrade(tradeSignal, freshPortfolio, DEFAULT_RISK_CONFIG)

        if (!validation.approved) {
          rejected.push(`${symbol}: ${validation.reason}`)
          log.push(`${symbol}: risk check failed — ${validation.reason}`)
          await alerts.tradeRejected(symbol, validation.reason || 'Risk check failed')
          continue
        }

        // Execute
        const result = await executeTrade(tradeSignal, validation.adjustedSize!)
        executed.push(symbol)
        signalsExecuted++

        log.push(`✓ ${symbol} ${signal.action.toUpperCase()} executed — order ${result.orderId} [${result.mode}]`)

        await alerts.tradeOpened(
          symbol,
          signal.action,
          lastClose,
          stopLoss,
          takeProfit,
          validation.adjustedSize!,
          signal.confidence,
          result.mode
        )

        // Wait between executions
        await new Promise(r => setTimeout(r, 500))

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        log.push(`Error on ${symbol}: ${msg}`)
        rejected.push(`${symbol}: error — ${msg}`)
      }
    }

    const summary = {
      runId,
      timestamp: new Date().toISOString(),
      scanned: AUTO_WATCHLIST.length,
      candidates: candidates.length,
      executed: executed.length,
      executedSymbols: executed,
      rejected: rejected.length,
      rejectedReasons: rejected,
      mode: portfolio.mode,
      log,
    }

    // Send daily summary if any trades were executed
    if (executed.length > 0) {
      await alerts.dailySummary(executed.length, 0, 0, 0)
    }

    log.push(`Run complete — ${executed.length} trades executed`)
    return res.status(200).json(summary)

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    await alerts.systemError(`automate run failed: ${message}`)
    return res.status(500).json({ runId, error: message, log })
  }
}

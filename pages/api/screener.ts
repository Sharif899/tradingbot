/**
 * pages/api/screener.ts
 * GET /api/screener?tier=all|tier1|tier2&timeframe=1h
 *
 * Scans all coins in parallel, runs technical analysis on each,
 * returns ranked list of opportunities without calling Claude
 * (Claude only gets called when you want a full signal on a specific coin).
 *
 * This is intentionally fast — pure math, no AI — so you can scan
 * 50 coins in a few seconds and surface the top candidates.
 */

import type { NextApiRequest, NextApiResponse } from 'next'
import { fetchCandles } from '@/lib/exchange'
import { TIER1_COINS, TIER2_COINS, ALL_COINS } from '@/lib/coins'
import { buildIndicators } from '@/lib/signalEngine'

export interface ScreenerResult {
  symbol: string
  tier: 1 | 2
  price: number
  change24h: number
  volume24h: number
  rsi: number
  trend: 'up' | 'down' | 'sideways'
  macdSignal: 'bullish' | 'bearish' | 'neutral'
  bbPosition: 'upper' | 'lower' | 'middle'   // where price is relative to BB
  volumeSpike: boolean                          // volume > 2x average
  score: number                                 // 0–100 composite opportunity score
  bias: 'long' | 'short' | 'neutral'
  reasons: string[]
}

function scoreSymbol(
  indicators: ReturnType<typeof buildIndicators>,
  lastClose: number,
  change24h: number
): { score: number; bias: 'long' | 'short' | 'neutral'; reasons: string[] } {
  let longScore = 0
  let shortScore = 0
  const reasons: string[] = []

  // RSI signals
  if (indicators.rsi < 30) {
    longScore += 25
    reasons.push(`RSI oversold (${indicators.rsi.toFixed(1)})`)
  } else if (indicators.rsi > 70) {
    shortScore += 25
    reasons.push(`RSI overbought (${indicators.rsi.toFixed(1)})`)
  } else if (indicators.rsi < 40) {
    longScore += 10
    reasons.push(`RSI weakening (${indicators.rsi.toFixed(1)})`)
  } else if (indicators.rsi > 60) {
    shortScore += 10
    reasons.push(`RSI strengthening (${indicators.rsi.toFixed(1)})`)
  }

  // MACD
  if (indicators.macd.histogram > 0 && indicators.macd.macd > indicators.macd.signal) {
    longScore += 15
    reasons.push('MACD bullish crossover')
  } else if (indicators.macd.histogram < 0 && indicators.macd.macd < indicators.macd.signal) {
    shortScore += 15
    reasons.push('MACD bearish crossover')
  }

  // EMA trend alignment
  if (indicators.trend === 'up') {
    longScore += 20
    reasons.push('EMAs aligned bullish (20>50>200)')
  } else if (indicators.trend === 'down') {
    shortScore += 20
    reasons.push('EMAs aligned bearish')
  }

  // Bollinger Band position
  const bbRange = indicators.bbUpper - indicators.bbLower
  const bbPct = (lastClose - indicators.bbLower) / bbRange

  if (bbPct < 0.1) {
    longScore += 20
    reasons.push('Price at lower Bollinger Band')
  } else if (bbPct > 0.9) {
    shortScore += 20
    reasons.push('Price at upper Bollinger Band')
  }

  // Volume spike adds confidence to any signal
  if (indicators.volumeRatio > 2.0) {
    const boost = 10
    longScore += longScore > shortScore ? boost : 0
    shortScore += shortScore > longScore ? boost : 0
    reasons.push(`Volume spike ${indicators.volumeRatio.toFixed(1)}x average`)
  }

  // Price vs EMA200 — trend filter
  if (lastClose > indicators.ema200) {
    longScore += 10
    reasons.push('Price above EMA200')
  } else {
    shortScore += 10
    reasons.push('Price below EMA200')
  }

  const topScore = Math.max(longScore, shortScore)
  const bias = longScore > shortScore + 5 ? 'long'
    : shortScore > longScore + 5 ? 'short'
    : 'neutral'

  // Normalize to 0-100
  const score = Math.min(100, topScore)

  return { score, bias, reasons: reasons.slice(0, 4) }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const tier = (req.query.tier as string) || 'all'
  const timeframe = (req.query.timeframe as string) || '1h'
  const minScore = parseInt((req.query.minScore as string) || '40')

  let symbols: string[]
  if (tier === 'tier1') symbols = TIER1_COINS
  else if (tier === 'tier2') symbols = TIER2_COINS
  else symbols = ALL_COINS

  // Scan all symbols in parallel — cap concurrency to avoid rate limits
  const BATCH_SIZE = 10
  const results: ScreenerResult[] = []

  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE)
    const batchResults = await Promise.allSettled(
      batch.map(async (symbol) => {
        try {
          const candles = await fetchCandles(symbol, timeframe, 100)
          if (candles.length < 50) return null

          const indicators = buildIndicators({ symbol, candles, fundingRate: 0, openInterest: 0, oiChange24h: 0, longShortRatio: 1 })
          const lastClose = candles[candles.length - 1].close
          const prevClose = candles[candles.length - 25]?.close || lastClose
          const change24h = (lastClose - prevClose) / prevClose

          const { score, bias, reasons } = scoreSymbol(indicators, lastClose, change24h)

          const bbRange = indicators.bbUpper - indicators.bbLower
          const bbPct = (lastClose - indicators.bbLower) / bbRange
          const bbPosition = bbPct > 0.8 ? 'upper' : bbPct < 0.2 ? 'lower' : 'middle'

          const result: ScreenerResult = {
            symbol,
            tier: TIER1_COINS.includes(symbol) ? 1 : 2,
            price: lastClose,
            change24h,
            volume24h: candles.slice(-24).reduce((s, c) => s + c.volume * c.close, 0),
            rsi: indicators.rsi,
            trend: indicators.trend,
            macdSignal: indicators.macd.histogram > 0 ? 'bullish' : indicators.macd.histogram < 0 ? 'bearish' : 'neutral',
            bbPosition,
            volumeSpike: indicators.volumeRatio > 2.0,
            score,
            bias,
            reasons,
          }
          return result
        } catch {
          return null
        }
      })
    )

    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value && r.value.score >= minScore) {
        results.push(r.value)
      }
    })

    // Small delay between batches to respect rate limits
    if (i + BATCH_SIZE < symbols.length) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score)

  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate')
  return res.status(200).json({
    total: results.length,
    scanned: symbols.length,
    timeframe,
    timestamp: Date.now(),
    results,
  })
}

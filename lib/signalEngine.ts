/**
 * lib/signalEngine.ts
 * ─────────────────────────────────────────────────────────────────
 * Generates trading signals by combining:
 *  1. Technical indicators (RSI, MACD, Bollinger Bands, EMA)
 *  2. Market microstructure (funding rate, open interest)
 *  3. Claude AI as the final decision layer + reasoning
 *
 * The AI doesn't predict prices — it evaluates whether all conditions
 * align well enough to justify a trade given current risk.
 */

import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export interface Candle {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface MarketContext {
  symbol: string
  candles: Candle[]           // At least 100 candles recommended
  fundingRate: number         // Current perpetual funding rate
  openInterest: number        // Total OI in USD
  oiChange24h: number         // % change in OI over 24h
  longShortRatio: number      // >1 means more longs
  fearGreedIndex?: number     // 0-100 (optional)
}

export interface TechnicalIndicators {
  rsi: number
  macd: { macd: number; signal: number; histogram: number }
  ema20: number
  ema50: number
  ema200: number
  bbUpper: number
  bbMiddle: number
  bbLower: number
  atr: number
  volumeRatio: number         // Current vol vs 20-period average
  trend: 'up' | 'down' | 'sideways'
}

export interface AISignal {
  action: 'long' | 'short' | 'wait'
  confidence: number          // 0–1
  reasoning: string           // Claude's explanation
  keyFactors: string[]        // Bullet points of what drove the decision
  risks: string[]             // What could invalidate this trade
  suggestedLeverage: number
}

// ─── Technical Indicator Calculations ────────────────────────────────────────

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50
  const changes = closes.slice(-period - 1).map((c, i, arr) =>
    i === 0 ? 0 : c - arr[i - 1]
  ).slice(1)

  const gains = changes.filter(c => c > 0)
  const losses = changes.filter(c => c < 0).map(Math.abs)
  const avgGain = gains.reduce((a, b) => a + b, 0) / period
  const avgLoss = losses.reduce((a, b) => a + b, 0) / period

  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

export function calcEMA(closes: number[], period: number): number {
  if (closes.length < period) return closes[closes.length - 1]
  const k = 2 / (period + 1)
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period
  closes.slice(period).forEach(c => { ema = c * k + ema * (1 - k) })
  return ema
}

export function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const macd = ema12 - ema26
  // Simplified signal (would need more history for true EMA of MACD)
  const signal = macd * 0.85
  return { macd, signal, histogram: macd - signal }
}

export function calcBollingerBands(closes: number[], period = 20, stdDev = 2) {
  const slice = closes.slice(-period)
  const mean = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period
  const std = Math.sqrt(variance)
  return { bbUpper: mean + stdDev * std, bbMiddle: mean, bbLower: mean - stdDev * std }
}

export function calcATR(candles: Candle[], period = 14): number {
  const trs = candles.slice(-period - 1).map((c, i, arr) => {
    if (i === 0) return c.high - c.low
    const prev = arr[i - 1]
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close))
  }).slice(1)
  return trs.reduce((a, b) => a + b, 0) / period
}

export function buildIndicators(ctx: MarketContext): TechnicalIndicators {
  const closes = ctx.candles.map(c => c.close)
  const ema20 = calcEMA(closes, 20)
  const ema50 = calcEMA(closes, 50)
  const ema200 = calcEMA(closes, 200)
  const last = closes[closes.length - 1]

  const trend = last > ema20 && ema20 > ema50 ? 'up'
    : last < ema20 && ema20 < ema50 ? 'down'
    : 'sideways'

  const volumes = ctx.candles.map(c => c.volume)
  const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20
  const currentVol = volumes[volumes.length - 1]

  return {
    rsi: calcRSI(closes),
    macd: calcMACD(closes),
    ema20, ema50, ema200,
    ...calcBollingerBands(closes),
    atr: calcATR(ctx.candles),
    volumeRatio: currentVol / avgVol,
    trend,
  }
}

// ─── AI Decision Layer ────────────────────────────────────────────────────────

export async function generateSignal(ctx: MarketContext): Promise<AISignal> {
  const indicators = buildIndicators(ctx)
  const lastCandle = ctx.candles[ctx.candles.length - 1]

  const prompt = `You are a professional crypto futures trader and risk manager analyzing a potential trade.

## Market: ${ctx.symbol}
## Current Price: $${lastCandle.close.toFixed(2)}
## Timestamp: ${new Date(lastCandle.timestamp).toISOString()}

## Technical Indicators
- RSI(14): ${indicators.rsi.toFixed(1)} ${indicators.rsi > 70 ? '(OVERBOUGHT)' : indicators.rsi < 30 ? '(OVERSOLD)' : '(neutral)'}
- MACD: ${indicators.macd.macd.toFixed(4)} | Signal: ${indicators.macd.signal.toFixed(4)} | Histogram: ${indicators.macd.histogram.toFixed(4)}
- EMA 20: $${indicators.ema20.toFixed(2)} | EMA 50: $${indicators.ema50.toFixed(2)} | EMA 200: $${indicators.ema200.toFixed(2)}
- Bollinger Bands: Upper $${indicators.bbUpper.toFixed(2)} | Mid $${indicators.bbMiddle.toFixed(2)} | Lower $${indicators.bbLower.toFixed(2)}
- ATR(14): $${indicators.atr.toFixed(2)} (${((indicators.atr / lastCandle.close) * 100).toFixed(2)}% of price)
- Volume ratio vs 20MA: ${indicators.volumeRatio.toFixed(2)}x
- Overall trend: ${indicators.trend.toUpperCase()}

## Market Microstructure
- Funding rate: ${(ctx.fundingRate * 100).toFixed(4)}% ${ctx.fundingRate > 0.001 ? '(elevated — longs paying, bearish lean)' : ctx.fundingRate < -0.001 ? '(negative — shorts paying, bullish lean)' : '(neutral)'}
- Open interest: $${(ctx.openInterest / 1e6).toFixed(1)}M (24h change: ${(ctx.oiChange24h * 100).toFixed(1)}%)
- Long/Short ratio: ${ctx.longShortRatio.toFixed(2)} ${ctx.longShortRatio > 1.5 ? '(crowded long)' : ctx.longShortRatio < 0.7 ? '(crowded short)' : ''}
${ctx.fearGreedIndex !== undefined ? `- Fear & Greed Index: ${ctx.fearGreedIndex}/100` : ''}

## Last 5 Candles (OHLCV)
${ctx.candles.slice(-5).map(c =>
  `  ${new Date(c.timestamp).toISOString().slice(11,19)} O:${c.open.toFixed(2)} H:${c.high.toFixed(2)} L:${c.low.toFixed(2)} C:${c.close.toFixed(2)} V:${c.volume.toFixed(0)}`
).join('\n')}

## Your Task
Analyze all available data and decide: LONG, SHORT, or WAIT.

Be highly selective. Only signal LONG or SHORT when multiple independent signals align.
Default to WAIT when uncertain — missing a trade costs nothing; a bad trade costs capital.

Respond ONLY with a valid JSON object (no markdown, no explanation outside JSON):
{
  "action": "long" | "short" | "wait",
  "confidence": 0.0-1.0,
  "reasoning": "2-3 sentence summary of your analysis",
  "keyFactors": ["factor 1", "factor 2", "factor 3"],
  "risks": ["risk 1", "risk 2"],
  "suggestedLeverage": 1-5
}`

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''

  try {
    const clean = text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(clean) as AISignal
    // Clamp confidence to valid range
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence))
    parsed.suggestedLeverage = Math.min(5, Math.max(1, parsed.suggestedLeverage))
    return parsed
  } catch {
    // If parsing fails, default to WAIT (safe)
    return {
      action: 'wait',
      confidence: 0,
      reasoning: 'Failed to parse AI response. Defaulting to WAIT for safety.',
      keyFactors: ['Parse error'],
      risks: ['System error'],
      suggestedLeverage: 1,
    }
  }
}

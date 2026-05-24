/**
 * lib/riskEngine.ts
 * ─────────────────────────────────────────────────────────────────
 * The most critical file in the entire system.
 * Every trade signal MUST pass through validateTrade() before execution.
 * If this returns { approved: false }, the trade is dropped — no exceptions.
 */

export interface TradeSignal {
  symbol: string          // e.g. "BTC/USDT:USDT"
  side: 'long' | 'short'
  confidence: number      // 0–1 from AI model
  entryPrice: number
  stopLoss: number
  takeProfit: number
  leverage: number
}

export interface PortfolioState {
  totalCapital: number         // Total USDT value
  availableCapital: number
  openPositions: Position[]
  dailyPnl: number             // Realized + unrealized PnL today
  dailyPnlPct: number
  peakCapital: number          // For drawdown calculation
}

export interface Position {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  currentPrice: number
  unrealizedPnl: number
  leverage: number
}

export interface RiskValidation {
  approved: boolean
  reason?: string
  adjustedSize?: number        // Engine may reduce size but still approve
  warnings: string[]
}

export interface RiskConfig {
  maxRiskPerTrade: number      // Fraction of capital, e.g. 0.01 = 1%
  maxDailyDrawdown: number     // e.g. 0.05 = 5%
  maxLeverage: number          // Hard cap
  maxOpenPositions: number
  minConfidence: number        // AI confidence threshold, e.g. 0.65
  correlatedAssets: string[][] // Groups of correlated assets
  maxCorrelatedExposure: number // Max combined exposure per correlated group
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxRiskPerTrade: parseFloat(process.env.MAX_RISK_PER_TRADE || '0.01'),
  maxDailyDrawdown: parseFloat(process.env.MAX_DAILY_DRAWDOWN || '0.05'),
  maxLeverage: parseFloat(process.env.MAX_LEVERAGE || '5'),
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '3'),
  minConfidence: 0.65,
  correlatedAssets: [
    ['BTC/USDT:USDT', 'ETH/USDT:USDT'],  // BTC/ETH move together
    ['SOL/USDT:USDT', 'AVAX/USDT:USDT', 'NEAR/USDT:USDT'],  // L1 alts
  ],
  maxCorrelatedExposure: 0.10,  // Max 10% capital in correlated group
}

// ─── Main validation gate ────────────────────────────────────────────────────

export function validateTrade(
  signal: TradeSignal,
  portfolio: PortfolioState,
  config: RiskConfig = DEFAULT_RISK_CONFIG
): RiskValidation {
  const warnings: string[] = []

  // 1. Circuit breaker: daily loss limit
  if (portfolio.dailyPnlPct <= -config.maxDailyDrawdown) {
    return {
      approved: false,
      reason: `Circuit breaker: daily loss ${(portfolio.dailyPnlPct * 100).toFixed(2)}% exceeds limit of ${(config.maxDailyDrawdown * 100).toFixed(2)}%. Trading paused until tomorrow.`,
      warnings,
    }
  }

  // 2. Too many open positions
  if (portfolio.openPositions.length >= config.maxOpenPositions) {
    return {
      approved: false,
      reason: `Max open positions (${config.maxOpenPositions}) reached.`,
      warnings,
    }
  }

  // 3. AI confidence too low
  if (signal.confidence < config.minConfidence) {
    return {
      approved: false,
      reason: `AI confidence ${(signal.confidence * 100).toFixed(1)}% below minimum ${(config.minConfidence * 100).toFixed(1)}%.`,
      warnings,
    }
  }

  // 4. Leverage cap
  if (signal.leverage > config.maxLeverage) {
    warnings.push(`Leverage reduced from ${signal.leverage}x to max allowed ${config.maxLeverage}x.`)
    signal = { ...signal, leverage: config.maxLeverage }
  }

  // 5. Stop loss must be set and reasonable
  const slDistance = Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice
  if (slDistance === 0) {
    return { approved: false, reason: 'Stop loss not set.', warnings }
  }
  if (slDistance > 0.10) {
    return {
      approved: false,
      reason: `Stop loss distance ${(slDistance * 100).toFixed(1)}% is too wide (max 10%). Tighten your stop.`,
      warnings,
    }
  }

  // 6. Position sizing via fixed-fraction method
  // Risk amount = capital × maxRiskPerTrade
  // Position size = riskAmount / (entryPrice × slDistance × leverage)
  const riskAmount = portfolio.totalCapital * config.maxRiskPerTrade
  const positionSize = riskAmount / (signal.entryPrice * slDistance)
  const notionalValue = positionSize * signal.entryPrice
  const capitalRequired = notionalValue / signal.leverage

  if (capitalRequired > portfolio.availableCapital) {
    return {
      approved: false,
      reason: `Insufficient capital. Required: $${capitalRequired.toFixed(2)}, Available: $${portfolio.availableCapital.toFixed(2)}`,
      warnings,
    }
  }

  // 7. Correlated asset exposure check
  const correlatedGroup = config.correlatedAssets.find(g => g.includes(signal.symbol))
  if (correlatedGroup) {
    const existingCorrelatedExposure = portfolio.openPositions
      .filter(p => correlatedGroup.includes(p.symbol))
      .reduce((sum, p) => sum + (p.size * p.currentPrice) / p.leverage, 0)

    const totalCorrelatedPct = (existingCorrelatedExposure + capitalRequired) / portfolio.totalCapital
    if (totalCorrelatedPct > config.maxCorrelatedExposure) {
      return {
        approved: false,
        reason: `Correlated asset exposure ${(totalCorrelatedPct * 100).toFixed(1)}% exceeds max ${(config.maxCorrelatedExposure * 100).toFixed(1)}%. Already have exposure to a correlated asset.`,
        warnings,
      }
    }
    if (existingCorrelatedExposure > 0) {
      warnings.push(`Adding to correlated group: ${correlatedGroup.join(', ')}`)
    }
  }

  // 8. Warn if close to daily drawdown limit
  const currentDrawdownPct = Math.abs(Math.min(portfolio.dailyPnlPct, 0))
  const drawdownHeadroom = config.maxDailyDrawdown - currentDrawdownPct
  if (drawdownHeadroom < 0.02) {
    warnings.push(`⚠️ Only ${(drawdownHeadroom * 100).toFixed(1)}% daily loss headroom remaining.`)
  }

  return {
    approved: true,
    adjustedSize: positionSize,
    warnings,
  }
}

// ─── ATR-based dynamic stop loss ─────────────────────────────────────────────

export function calculateATRStopLoss(
  candles: { high: number; low: number; close: number }[],
  entryPrice: number,
  side: 'long' | 'short',
  atrMultiplier: number = 2.0,
  period: number = 14
): { stopLoss: number; takeProfit: number; atr: number } {
  if (candles.length < period + 1) {
    throw new Error(`Need at least ${period + 1} candles for ATR calculation`)
  }

  // Calculate True Range for each candle
  const trueRanges = candles.slice(1).map((c, i) => {
    const prev = candles[i]
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    )
  })

  // Simple ATR (average of last `period` true ranges)
  const recentTR = trueRanges.slice(-period)
  const atr = recentTR.reduce((a, b) => a + b, 0) / period

  const stopDistance = atr * atrMultiplier
  const stopLoss = side === 'long'
    ? entryPrice - stopDistance
    : entryPrice + stopDistance

  // 2:1 reward-to-risk minimum
  const takeProfit = side === 'long'
    ? entryPrice + stopDistance * 2
    : entryPrice - stopDistance * 2

  return { stopLoss, takeProfit, atr }
}

// ─── Drawdown calculator ──────────────────────────────────────────────────────

export function calculateDrawdown(equityCurve: number[]): {
  currentDrawdown: number
  maxDrawdown: number
  drawdownDuration: number
} {
  if (equityCurve.length === 0) return { currentDrawdown: 0, maxDrawdown: 0, drawdownDuration: 0 }

  let peak = equityCurve[0]
  let maxDrawdown = 0
  let currentDrawdown = 0
  let drawdownStart = -1
  let maxDuration = 0

  equityCurve.forEach((value, i) => {
    if (value > peak) {
      peak = value
      drawdownStart = -1
    }
    const dd = (peak - value) / peak
    if (dd > 0 && drawdownStart === -1) drawdownStart = i
    if (dd > maxDrawdown) maxDrawdown = dd
    if (i === equityCurve.length - 1) {
      currentDrawdown = dd
      if (drawdownStart !== -1) maxDuration = i - drawdownStart
    }
  })

  return { currentDrawdown, maxDrawdown, drawdownDuration: maxDuration }
}

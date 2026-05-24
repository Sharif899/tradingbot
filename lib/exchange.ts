/**
 * lib/exchange.ts
 * ─────────────────────────────────────────────────────────────────
 * Primary exchange: Bitget (fully works in Nigeria)
 * Fallbacks: Bybit, OKX
 * Paper trading mode intercepts all order calls and simulates fills.
 *
 * Bitget API setup:
 *  1. bitget.com → Profile → API Management → Create HMAC Key
 *  2. Permissions: Read-write + Futures order + Open interest
 *  3. Set a passphrase — store it safely
 *  4. NEVER enable Withdraw
 */

import ccxt from 'ccxt'
import type { TradeSignal } from './riskEngine'

const PAPER_TRADING = process.env.PAPER_TRADING !== 'false'
const PRIMARY_EXCHANGE = (process.env.PRIMARY_EXCHANGE || 'bitget') as 'bitget' | 'bybit' | 'okx'

// ─── Paper trading ledger ─────────────────────────────────────────────────────
let paperBalance = parseFloat(process.env.PAPER_STARTING_CAPITAL || '10000')
const paperPositions: PaperPosition[] = []
const paperTrades: PaperTrade[] = []

interface PaperPosition {
  id: string
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  stopLoss: number
  takeProfit: number
  leverage: number
  openedAt: number
}

interface PaperTrade {
  id: string
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  exitPrice: number
  pnl: number
  pnlPct: number
  closedAt: number
  closeReason: 'tp' | 'sl' | 'manual'
}


// Format for Bybit USDT perpetuals: "SYMBOL/USDT:USDT"

export const TIER1_COINS = [
  'BTC/USDT:USDT',
  'ETH/USDT:USDT',
  'BNB/USDT:USDT',
  'SOL/USDT:USDT',
  'XRP/USDT:USDT',
  'ADA/USDT:USDT',
  'AVAX/USDT:USDT',
  'DOT/USDT:USDT',
  'MATIC/USDT:USDT',
  'LINK/USDT:USDT',
]

export const TIER2_COINS = [
  // DeFi
  'UNI/USDT:USDT',
  'AAVE/USDT:USDT',
  'CRV/USDT:USDT',
  'MKR/USDT:USDT',
  'SNX/USDT:USDT',
  'COMP/USDT:USDT',
  'SUSHI/USDT:USDT',
  'BAL/USDT:USDT',
  // L1 / L2
  'NEAR/USDT:USDT',
  'FTM/USDT:USDT',
  'ONE/USDT:USDT',
  'ALGO/USDT:USDT',
  'ATOM/USDT:USDT',
  'ICP/USDT:USDT',
  'FIL/USDT:USDT',
  'HBAR/USDT:USDT',
  'VET/USDT:USDT',
  'EGLD/USDT:USDT',
  'XTZ/USDT:USDT',
  'EOS/USDT:USDT',
  // Meme / high vol
  'DOGE/USDT:USDT',
  'SHIB/USDT:USDT',
  'PEPE/USDT:USDT',
  'WIF/USDT:USDT',
  'BONK/USDT:USDT',
  // Gaming / NFT
  'AXS/USDT:USDT',
  'SAND/USDT:USDT',
  'MANA/USDT:USDT',
  'IMX/USDT:USDT',
  'GALA/USDT:USDT',
  // Exchange tokens
  'OKB/USDT:USDT',
  'CRO/USDT:USDT',
  'KCS/USDT:USDT',
  // Other notable
  'LTC/USDT:USDT',
  'BCH/USDT:USDT',
  'ETC/USDT:USDT',
  'TRX/USDT:USDT',
  'XLM/USDT:USDT',
  'CHZ/USDT:USDT',
  'ENJ/USDT:USDT',
  'ZEC/USDT:USDT',
]

export const ALL_COINS = [...TIER1_COINS, ...TIER2_COINS]

// ─── Exchange factory ─────────────────────────────────────────────────────────

export function createExchange(name: 'bitget' | 'bybit' | 'okx' = PRIMARY_EXCHANGE) {
  if (name === 'bitget') {
    return new ccxt.bitget({
      apiKey: process.env.BITGET_API_KEY,
      secret: process.env.BITGET_SECRET,
      password: process.env.BITGET_PASSPHRASE,
      options: { defaultType: 'swap' },
      enableRateLimit: true,
    })
  }

  if (name === 'bybit') {
    return new ccxt.bybit({
      apiKey: process.env.BYBIT_API_KEY,
      secret: process.env.BYBIT_SECRET,
      options: { defaultType: 'linear' },
      enableRateLimit: true,
    })
  }

  // OKX fallback
  return new ccxt.okx({
    apiKey: process.env.OKX_API_KEY,
    secret: process.env.OKX_SECRET,
    password: process.env.OKX_PASSPHRASE,
    options: { defaultType: 'swap' },
    enableRateLimit: true,
  })
}

// ─── Validate a symbol exists on the exchange ─────────────────────────────────

export async function validateSymbol(symbol: string): Promise<boolean> {
  try {
    const exchange = createExchange()
    await exchange.loadMarkets()
    return symbol in exchange.markets
  } catch {
    return false
  }
}

// ─── Market data ──────────────────────────────────────────────────────────────

export async function fetchCandles(
  symbol: string,
  timeframe: string = '1h',
  limit: number = 200
) {
  const exchange = createExchange()
  const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit)
  return ohlcv.map(([timestamp, open, high, low, close, volume]) => ({
    timestamp: timestamp as number,
    open: open as number,
    high: high as number,
    low: low as number,
    close: close as number,
    volume: volume as number,
  }))
}

export async function fetchFundingRate(symbol: string): Promise<number> {
  try {
    const exchange = createExchange()
    const funding = await exchange.fetchFundingRate(symbol)
    return funding.fundingRate ?? 0
  } catch {
    return 0
  }
}

export async function fetchTicker(symbol: string) {
  const exchange = createExchange()
  return exchange.fetchTicker(symbol)
}

// Fetch multiple tickers at once for the screener
export async function fetchAllTickers() {
  try {
    const exchange = createExchange()
    const symbols = ALL_COINS
    const tickers = await exchange.fetchTickers(symbols)
    return tickers
  } catch {
    return {}
  }
}

// ─── Order execution ──────────────────────────────────────────────────────────

export async function executeTrade(signal: TradeSignal, positionSize: number) {
  if (PAPER_TRADING) return executePaperTrade(signal, positionSize)
  return executeLiveTrade(signal, positionSize)
}

async function executeLiveTrade(signal: TradeSignal, positionSize: number) {
  const exchange = createExchange()

  // Bybit: set leverage
  await exchange.setLeverage(signal.leverage, signal.symbol)

  // Entry limit order
  const order = await exchange.createOrder(
    signal.symbol,
    'limit',
    signal.side === 'long' ? 'buy' : 'sell',
    positionSize,
    signal.entryPrice,
  )

  // Stop loss
  await exchange.createOrder(
    signal.symbol,
    'stop',
    signal.side === 'long' ? 'sell' : 'buy',
    positionSize,
    signal.stopLoss,
    {
      stopPrice: signal.stopLoss,
      reduceOnly: true,
      triggerBy: 'LastPrice',
    }
  )

  // Take profit
  await exchange.createOrder(
    signal.symbol,
    'takeProfit',
    signal.side === 'long' ? 'sell' : 'buy',
    positionSize,
    signal.takeProfit,
    {
      stopPrice: signal.takeProfit,
      reduceOnly: true,
      triggerBy: 'LastPrice',
    }
  )

  return { orderId: order.id, mode: 'live' as const }
}

function executePaperTrade(signal: TradeSignal, positionSize: number) {
  const margin = (positionSize * signal.entryPrice) / signal.leverage
  if (margin > paperBalance) {
    throw new Error(`Insufficient paper balance: need $${margin.toFixed(2)}, have $${paperBalance.toFixed(2)}`)
  }
  paperBalance -= margin
  const position: PaperPosition = {
    id: `paper_${Date.now()}`,
    symbol: signal.symbol,
    side: signal.side,
    size: positionSize,
    entryPrice: signal.entryPrice,
    stopLoss: signal.stopLoss,
    takeProfit: signal.takeProfit,
    leverage: signal.leverage,
    openedAt: Date.now(),
  }
  paperPositions.push(position)
  return { orderId: position.id, mode: 'paper' as const }
}

// ─── Close position ───────────────────────────────────────────────────────────

export async function closePosition(
  positionId: string,
  currentPrice: number,
  reason: 'tp' | 'sl' | 'manual'
) {
  if (PAPER_TRADING) {
    const idx = paperPositions.findIndex(p => p.id === positionId)
    if (idx === -1) throw new Error('Paper position not found')
    const pos = paperPositions[idx]
    const priceDiff = currentPrice - pos.entryPrice
    const pnl = pos.side === 'long' ? priceDiff * pos.size : -priceDiff * pos.size
    const margin = (pos.size * pos.entryPrice) / pos.leverage
    paperBalance += margin + pnl
    const trade: PaperTrade = {
      id: pos.id,
      symbol: pos.symbol,
      side: pos.side,
      size: pos.size,
      entryPrice: pos.entryPrice,
      exitPrice: currentPrice,
      pnl,
      pnlPct: pnl / margin,
      closedAt: Date.now(),
      closeReason: reason,
    }
    paperTrades.push(trade)
    paperPositions.splice(idx, 1)
    return trade
  }

  const exchange = createExchange()
  const positions = await exchange.fetchPositions([positionId])
  if (!positions.length) return null
  const pos = positions[0]
  return exchange.createOrder(
    pos.symbol, 'market',
    pos.side === 'long' ? 'sell' : 'buy',
    pos.contracts as number,
    undefined,
    { reduceOnly: true }
  )
}

// ─── Portfolio state ──────────────────────────────────────────────────────────

export async function getPortfolioState() {
  if (PAPER_TRADING) {
    return {
      totalCapital: paperBalance,
      availableCapital: paperBalance,
      openPositions: paperPositions.map(p => ({
        symbol: p.symbol,
        side: p.side,
        size: p.size,
        entryPrice: p.entryPrice,
        currentPrice: p.entryPrice,
        unrealizedPnl: 0,
        leverage: p.leverage,
      })),
      dailyPnl: 0,
      dailyPnlPct: 0,
      peakCapital: parseFloat(process.env.PAPER_STARTING_CAPITAL || '10000'),
      mode: 'paper' as const,
      paperTrades,
    }
  }

  const exchange = createExchange()
  const [balance, positions] = await Promise.all([
    exchange.fetchBalance(),
    exchange.fetchPositions(),
  ])

  const usdt = balance.USDT || balance.total
  return {
    totalCapital: usdt.total as number,
    availableCapital: usdt.free as number,
    openPositions: positions
      .filter(p => Math.abs(p.contracts as number) > 0)
      .map(p => ({
        symbol: p.symbol,
        side: p.side as 'long' | 'short',
        size: Math.abs(p.contracts as number),
        entryPrice: p.entryPrice as number,
        currentPrice: p.markPrice as number,
        unrealizedPnl: p.unrealizedPnl as number,
        leverage: p.leverage as number,
      })),
    dailyPnl: 0,
    dailyPnlPct: 0,
    peakCapital: usdt.total as number,
    mode: 'live' as const,
  }
}

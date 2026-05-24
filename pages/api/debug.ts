/**
 * pages/api/debug.ts
 * GET /api/debug — tests exchange connection and shows exact error
 * DELETE THIS FILE before going live
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { createExchange } from '@/lib/exchange'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const results: Record<string, unknown> = {}

  // Test 1: Can we load markets?
  try {
    const exchange = createExchange()
    const markets = await exchange.loadMarkets()
    const futuresMarkets = Object.keys(markets).filter(s => s.includes(':USDT'))
    results.marketsLoaded = true
    results.totalMarkets = Object.keys(markets).length
    results.sampleFuturesSymbols = futuresMarkets.slice(0, 10)
    results.btcSymbol = futuresMarkets.find(s => s.startsWith('BTC'))
    results.bnbSymbol = futuresMarkets.find(s => s.startsWith('BNB'))
    results.ethSymbol = futuresMarkets.find(s => s.startsWith('ETH'))
  } catch (e) {
    results.marketsError = e instanceof Error ? e.message : String(e)
  }

  // Test 2: Fetch BTC candles
  try {
    const exchange = createExchange()
    const ohlcv = await exchange.fetchOHLCV('BTC/USDT:USDT', '1h', undefined, 3)
    results.btcCandlesOk = true
    results.btcLastPrice = ohlcv[ohlcv.length - 1][4]
  } catch (e) {
    results.btcCandlesError = e instanceof Error ? e.message : String(e)
  }

  // Test 3: Check env vars are set (not values, just whether they exist)
  results.envVars = {
    BITGET_API_KEY: !!process.env.BITGET_API_KEY,
    BITGET_SECRET: !!process.env.BITGET_SECRET,
    BITGET_PASSPHRASE: !!process.env.BITGET_PASSPHRASE,
    ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
    PRIMARY_EXCHANGE: process.env.PRIMARY_EXCHANGE || 'not set',
    PAPER_TRADING: process.env.PAPER_TRADING || 'not set',
  }

  return res.status(200).json(results)
}

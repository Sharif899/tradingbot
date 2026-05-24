// pages/index.tsx
import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import dynamic from 'next/dynamic'
import StatCard from '@/components/StatCard'
import SignalPanel from '@/components/SignalPanel'
import RiskGauge from '@/components/RiskGauge'
import styles from '@/styles/Dashboard.module.css'
import { TIER1_COINS, TIER2_COINS } from '@/lib/exchange'

// Screener loaded client-side only (heavy table)
const Screener = dynamic(() => import('@/components/Screener'), { ssr: false })

const ALL_SYMBOLS = [...TIER1_COINS, ...TIER2_COINS]
const TIMEFRAMES = ['15m', '1h', '4h', '1d']
const TABS = ['Signal', 'Screener'] as const
type Tab = typeof TABS[number]

interface SignalResponse {
  signal: {
    action: 'long' | 'short' | 'wait'
    confidence: number
    reasoning: string
    keyFactors: string[]
    risks: string[]
    suggestedLeverage: number
  }
  tradeSignal?: {
    symbol: string
    side: 'long' | 'short'
    confidence: number
    entryPrice: number
    stopLoss: number
    takeProfit: number
    leverage: number
  }
  validation?: {
    approved: boolean
    reason?: string
    adjustedSize?: number
    warnings: string[]
  }
  portfolioSnapshot?: {
    totalCapital: number
    availableCapital: number
    openPositions: number
    dailyPnlPct: number
    mode: 'paper' | 'live'
  }
}

export default function Dashboard() {
  const [tab, setTab] = useState<Tab>('Signal')
  const [symbol, setSymbol] = useState(TIER1_COINS[0])
  const [timeframe, setTimeframe] = useState('1h')
  const [signalData, setSignalData] = useState<SignalResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [portfolio, setPortfolio] = useState({
    totalCapital: 0,
    availableCapital: 0,
    openPositions: 0,
    dailyPnlPct: 0,
    mode: 'paper' as 'paper' | 'live',
  })

  const addLog = (msg: string) => {
    const ts = new Date().toLocaleTimeString()
    setLog(prev => [`[${ts}] ${msg}`, ...prev].slice(0, 50))
  }

  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch('/api/portfolio')
      if (res.ok) {
        const data = await res.json()
        setPortfolio(prev => ({ ...prev, ...data }))
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchPortfolio()
    const interval = setInterval(fetchPortfolio, 30000)
    return () => clearInterval(interval)
  }, [fetchPortfolio])

  const analyseMarket = async () => {
    setLoading(true)
    setSignalData(null)
    addLog(`Analysing ${symbol} on ${timeframe}...`)
    try {
      const res = await fetch(`/api/signal?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}`)
      if (!res.ok) throw new Error(`API error ${res.status}`)
      const data: SignalResponse = await res.json()
      setSignalData(data)
      setLastUpdated(new Date())
      if (data.portfolioSnapshot) setPortfolio(data.portfolioSnapshot)
      addLog(`Signal: ${data.signal.action.toUpperCase()} — confidence ${(data.signal.confidence * 100).toFixed(1)}%`)
      if (data.validation && !data.validation.approved) addLog(`⚠ Rejected: ${data.validation.reason}`)
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  const executeTrade = async () => {
    if (!signalData?.tradeSignal || !signalData?.validation?.approved) return
    setExecuting(true)
    addLog(`Executing ${signalData.tradeSignal.side.toUpperCase()} on ${symbol}...`)
    try {
      const res = await fetch('/api/trade/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dashboard-secret': process.env.NEXT_PUBLIC_DASHBOARD_SECRET || '',
        },
        body: JSON.stringify(signalData.tradeSignal),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error)
      addLog(`✓ Executed: ${result.orderId} [${result.mode.toUpperCase()}]`)
      result.warnings?.forEach((w: string) => addLog(`⚠ ${w}`))
      await fetchPortfolio()
    } catch (err) {
      addLog(`✗ Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setExecuting(false)
    }
  }

  // When screener selects a symbol, switch to signal tab
  const handleScreenerSelect = (sym: string) => {
    setSymbol(sym)
    setTab('Signal')
    setSignalData(null)
    addLog(`Selected from screener: ${sym}`)
  }

  const symbolShort = symbol.replace('/USDT:USDT', '')
  const isTier1 = TIER1_COINS.includes(symbol)
  const dailyPnlPositive = portfolio.dailyPnlPct >= 0

  return (
    <>
      <Head>
        <title>NEXUS — AI Crypto Futures</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      <div className={styles.layout}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.logo}>NEXUS</span>
            <span className={styles.logoSub}>AI Futures Engine</span>
          </div>
          <div className={styles.headerCenter}>
            <span className={`badge ${portfolio.mode === 'paper' ? 'badge-amber' : 'badge-red'}`}>
              {portfolio.mode === 'paper' ? '📋 PAPER' : '⚡ LIVE'}
            </span>
            {lastUpdated && (
              <span className={styles.lastUpdated}>Last: {lastUpdated.toLocaleTimeString()}</span>
            )}
          </div>
          <div className={styles.headerRight}>
            <span className={styles.time} suppressHydrationWarning>
              {new Date().toUTCString().slice(0, 25)} UTC
            </span>
          </div>
        </header>

        {/* Stats */}
        <div className={styles.statsRow}>
          <StatCard
            label="Total Capital"
            value={`$${portfolio.totalCapital.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            sub={`Available: $${portfolio.availableCapital.toFixed(2)}`}
            accent="blue"
          />
          <StatCard
            label="Daily P&L"
            value={`${dailyPnlPositive ? '+' : ''}${(portfolio.dailyPnlPct * 100).toFixed(2)}%`}
            sub="Resets 00:00 UTC"
            accent={dailyPnlPositive ? 'green' : 'red'}
          />
          <StatCard
            label="Open Positions"
            value={String(portfolio.openPositions)}
            sub="Max 3 simultaneous"
            accent={portfolio.openPositions > 0 ? 'amber' : 'default'}
          />
          <StatCard
            label="Universe"
            value="50 coins"
            sub="10 Tier 1 · 40 Tier 2"
            accent="blue"
          />
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {TABS.map(t => (
            <button key={t} className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`} onClick={() => setTab(t)}>
              {t === 'Screener' ? `◈ ${t}` : `◆ ${t}`}
            </button>
          ))}
        </div>

        {/* Main */}
        <div className={styles.main}>
          {tab === 'Signal' ? (
            <>
              {/* Left */}
              <div className={styles.left}>
                <div className={styles.controls}>
                  <div className={styles.controlGroup}>
                    <label className={styles.controlLabel}>SYMBOL</label>
                    <select value={symbol} onChange={e => { setSymbol(e.target.value); setSignalData(null) }} className={styles.select}>
                      <optgroup label="── Tier 1 ──">
                        {TIER1_COINS.map(s => <option key={s} value={s}>{s.replace('/USDT:USDT', '')} (T1)</option>)}
                      </optgroup>
                      <optgroup label="── Tier 2 ──">
                        {TIER2_COINS.map(s => <option key={s} value={s}>{s.replace('/USDT:USDT', '')} (T2)</option>)}
                      </optgroup>
                    </select>
                  </div>
                  <div className={styles.controlGroup}>
                    <label className={styles.controlLabel}>TIMEFRAME</label>
                    <div className={styles.tfGroup}>
                      {TIMEFRAMES.map(tf => (
                        <button key={tf} className={`${styles.tfBtn} ${timeframe === tf ? styles.tfActive : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.symbolMeta}>
                    <span className={`badge ${isTier1 ? 'badge-blue' : 'badge-amber'}`}>{isTier1 ? 'Tier 1' : 'Tier 2'}</span>
                    <span className={styles.symbolName}>{symbolShort}/USDT PERP</span>
                  </div>
                  <button className={styles.analyseBtn} onClick={analyseMarket} disabled={loading}>
                    {loading ? <><span className="pulse">◆</span> ANALYSING...</> : '◆ ANALYSE'}
                  </button>
                </div>

                <SignalPanel
                  signal={signalData?.signal || null}
                  validation={signalData?.validation || null}
                  loading={loading}
                  onExecute={executeTrade}
                  mode={portfolio.mode}
                />

                {signalData?.tradeSignal && (
                  <div className={styles.tradeDetails}>
                    <div className={styles.tdRow}><span>Entry</span><span className="mono">${signalData.tradeSignal.entryPrice.toFixed(4)}</span></div>
                    <div className={styles.tdRow}><span>Stop Loss</span><span className="mono text-red">${signalData.tradeSignal.stopLoss.toFixed(4)}</span></div>
                    <div className={styles.tdRow}><span>Take Profit</span><span className="mono text-green">${signalData.tradeSignal.takeProfit.toFixed(4)}</span></div>
                    <div className={styles.tdRow}><span>Leverage</span><span className="mono text-amber">{signalData.tradeSignal.leverage}x</span></div>
                    {signalData.validation?.adjustedSize && (
                      <div className={styles.tdRow}><span>Size</span><span className="mono">{signalData.validation.adjustedSize.toFixed(4)}</span></div>
                    )}
                  </div>
                )}
              </div>

              {/* Right */}
              <div className={styles.right}>
                <RiskGauge dailyPnlPct={portfolio.dailyPnlPct} maxDrawdown={0.05} openPositions={portfolio.openPositions} maxPositions={3} />
                <div className={styles.logPanel}>
                  <div className={styles.logHeader}>
                    <span className={styles.logTitle}>ACTIVITY LOG</span>
                    <button className={styles.clearBtn} onClick={() => setLog([])}>CLR</button>
                  </div>
                  <div className={styles.logBody}>
                    {log.length === 0 && <span className={styles.logEmpty}>No activity<span className="blink">_</span></span>}
                    {log.map((entry, i) => <div key={i} className={styles.logEntry}>{entry}</div>)}
                  </div>
                </div>
                <div className={styles.configPanel}>
                  <span className={styles.configTitle}>RISK CONFIG</span>
                  <div className={styles.configRow}><span>Max risk/trade</span><span className="mono">1%</span></div>
                  <div className={styles.configRow}><span>Daily drawdown</span><span className="mono">5%</span></div>
                  <div className={styles.configRow}><span>Max leverage</span><span className="mono">5x</span></div>
                  <div className={styles.configRow}><span>Min AI confidence</span><span className="mono">65%</span></div>
                  <div className={styles.configRow}><span>Exchange</span><span className="mono">Bybit</span></div>
                </div>
              </div>
            </>
          ) : (
            <div className={styles.screenerTab}>
              <Screener onSelectSymbol={handleScreenerSelect} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}

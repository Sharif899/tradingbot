// components/Screener.tsx
import { useState, useCallback } from 'react'
import type { ScreenerResult } from '@/pages/api/screener'
import styles from './Screener.module.css'

interface Props {
  onSelectSymbol: (symbol: string) => void
}

const TIER_OPTIONS = [
  { value: 'all',   label: 'All coins' },
  { value: 'tier1', label: 'Tier 1 only' },
  { value: 'tier2', label: 'Tier 2 only' },
]

const TF_OPTIONS = ['15m', '1h', '4h', '1d']

export default function Screener({ onSelectSymbol }: Props) {
  const [results, setResults] = useState<ScreenerResult[]>([])
  const [loading, setLoading] = useState(false)
  const [tier, setTier] = useState('all')
  const [timeframe, setTimeframe] = useState('1h')
  const [bias, setBias] = useState<'all' | 'long' | 'short'>('all')
  const [scannedInfo, setScannedInfo] = useState<{ total: number; scanned: number } | null>(null)

  const runScreener = useCallback(async () => {
    setLoading(true)
    setResults([])
    try {
      const res = await fetch(`/api/screener?tier=${tier}&timeframe=${timeframe}&minScore=35`)
      if (!res.ok) throw new Error('Screener failed')
      const data = await res.json()
      setScannedInfo({ total: data.total, scanned: data.scanned })
      setResults(data.results)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [tier, timeframe])

  const filtered = bias === 'all' ? results : results.filter(r => r.bias === bias)

  const formatPrice = (p: number) =>
    p >= 1000 ? `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}` :
    p >= 1 ? `$${p.toFixed(3)}` : `$${p.toFixed(6)}`

  const formatVol = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` :
    v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`

  return (
    <div className={styles.container}>
      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <label className={styles.label}>TIER</label>
          <select value={tier} onChange={e => setTier(e.target.value)} className={styles.select}>
            {TIER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className={styles.controlGroup}>
          <label className={styles.label}>TIMEFRAME</label>
          <div className={styles.btnGroup}>
            {TF_OPTIONS.map(tf => (
              <button key={tf} className={`${styles.tfBtn} ${timeframe === tf ? styles.active : ''}`} onClick={() => setTimeframe(tf)}>{tf}</button>
            ))}
          </div>
        </div>
        <div className={styles.controlGroup}>
          <label className={styles.label}>BIAS</label>
          <div className={styles.btnGroup}>
            {(['all', 'long', 'short'] as const).map(b => (
              <button key={b} className={`${styles.tfBtn} ${bias === b ? styles.active : ''} ${b !== 'all' ? styles[b] : ''}`} onClick={() => setBias(b)}>
                {b === 'long' ? '▲ Long' : b === 'short' ? '▼ Short' : 'All'}
              </button>
            ))}
          </div>
        </div>
        <button className={styles.scanBtn} onClick={runScreener} disabled={loading}>
          {loading ? <><span className="pulse">◆</span> SCANNING {tier === 'tier1' ? '10' : tier === 'tier2' ? '40' : '50'} COINS...</> : '◆ SCAN MARKET'}
        </button>
      </div>

      {scannedInfo && !loading && (
        <div className={styles.summary}>
          Found <strong>{filtered.length}</strong> opportunities from {scannedInfo.scanned} coins scanned
          {bias !== 'all' && ` (${bias} bias)`}
        </div>
      )}

      {loading && (
        <div className={styles.scanning}>
          <div className={styles.scanBar}><div className={styles.scanFill} /></div>
          <span>Analysing price action across all coins...</span>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Tier</th>
                <th>Price</th>
                <th>24h</th>
                <th>RSI</th>
                <th>Trend</th>
                <th>MACD</th>
                <th>Volume</th>
                <th>Score</th>
                <th>Bias</th>
                <th>Key signals</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.symbol} className={styles.row} onClick={() => onSelectSymbol(r.symbol)}>
                  <td className={styles.symbol}>{r.symbol.replace('/USDT:USDT', '')}</td>
                  <td><span className={`${styles.tierBadge} ${r.tier === 1 ? styles.tier1 : styles.tier2}`}>T{r.tier}</span></td>
                  <td className={styles.mono}>{formatPrice(r.price)}</td>
                  <td className={`${styles.mono} ${r.change24h >= 0 ? styles.green : styles.red}`}>
                    {r.change24h >= 0 ? '+' : ''}{(r.change24h * 100).toFixed(2)}%
                  </td>
                  <td>
                    <span className={`${styles.mono} ${r.rsi < 30 ? styles.green : r.rsi > 70 ? styles.red : styles.muted}`}>
                      {r.rsi.toFixed(0)}
                    </span>
                  </td>
                  <td><span className={`${styles.trendBadge} ${styles[r.trend]}`}>{r.trend}</span></td>
                  <td><span className={`${styles.macd} ${styles[r.macdSignal]}`}>{r.macdSignal.slice(0, 4)}</span></td>
                  <td className={styles.mono}>{formatVol(r.volume24h)} {r.volumeSpike && <span className={styles.spike}>⚡</span>}</td>
                  <td>
                    <div className={styles.scoreWrap}>
                      <div className={styles.scoreBar}>
                        <div className={`${styles.scoreFill} ${r.score >= 70 ? styles.scoreHigh : r.score >= 50 ? styles.scoreMid : styles.scoreLow}`} style={{ width: `${r.score}%` }} />
                      </div>
                      <span className={styles.scoreNum}>{r.score}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`${styles.biasBadge} ${r.bias === 'long' ? styles.long : r.bias === 'short' ? styles.short : styles.neutral}`}>
                      {r.bias === 'long' ? '▲' : r.bias === 'short' ? '▼' : '—'} {r.bias}
                    </span>
                  </td>
                  <td className={styles.reasons}>{r.reasons[0]}</td>
                  <td>
                    <button className={styles.analyseBtn} onClick={e => { e.stopPropagation(); onSelectSymbol(r.symbol) }}>
                      ANALYSE →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && results.length === 0 && scannedInfo && (
        <div className={styles.empty}>No strong opportunities found. Try a different timeframe or lower the score threshold.</div>
      )}
    </div>
  )
}

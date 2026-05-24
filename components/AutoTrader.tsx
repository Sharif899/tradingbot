// components/AutoTrader.tsx
import { useState } from 'react'
import styles from './AutoTrader.module.css'

interface RunResult {
  runId: string
  scanned: number
  candidates: number
  executed: number
  executedSymbols: string[]
  rejected: number
  mode: string
  log: string[]
}

export default function AutoTrader() {
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<RunResult | null>(null)
  const [showLog, setShowLog] = useState(false)

  const triggerRun = async () => {
    setRunning(true)
    try {
      const res = await fetch('/api/automate', {
        method: 'POST',
        headers: {
          'x-dashboard-secret': process.env.NEXT_PUBLIC_DASHBOARD_SECRET || '',
        },
      })
      const data = await res.json()
      setLastRun(data)
    } catch (err) {
      console.error(err)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>AUTO TRADER</div>
          <div className={styles.sub}>Runs every hour via Vercel cron • Scans 20 coins • Min 70% confidence</div>
        </div>
        <button className={styles.runBtn} onClick={triggerRun} disabled={running}>
          {running ? <><span className="pulse">◆</span> SCANNING...</> : '▶ RUN NOW'}
        </button>
      </div>

      <div className={styles.cronInfo}>
        <span className={styles.cronDot} />
        <span>Cron active — runs automatically at the top of every hour</span>
      </div>

      {lastRun && (
        <div className={styles.result}>
          <div className={styles.resultRow}>
            <span>Scanned</span><span className="mono">{lastRun.scanned} coins</span>
          </div>
          <div className={styles.resultRow}>
            <span>Candidates</span><span className="mono">{lastRun.candidates}</span>
          </div>
          <div className={styles.resultRow}>
            <span>Executed</span>
            <span className={`mono ${lastRun.executed > 0 ? 'text-green' : 'text-muted'}`}>
              {lastRun.executed} trades
              {lastRun.executedSymbols.length > 0 && ` (${lastRun.executedSymbols.join(', ').replace(/\/USDT:USDT/g, '')})`}
            </span>
          </div>
          <div className={styles.resultRow}>
            <span>Rejected</span><span className="mono text-muted">{lastRun.rejected}</span>
          </div>
          <div className={styles.resultRow}>
            <span>Mode</span>
            <span className={`mono ${lastRun.mode === 'paper' ? 'text-amber' : 'text-red'}`}>
              {lastRun.mode.toUpperCase()}
            </span>
          </div>
          <button className={styles.logBtn} onClick={() => setShowLog(!showLog)}>
            {showLog ? '▲ Hide log' : '▼ Show full log'}
          </button>
          {showLog && (
            <div className={styles.log}>
              {lastRun.log.map((l, i) => <div key={i} className={styles.logLine}>{l}</div>)}
            </div>
          )}
        </div>
      )}

      <div className={styles.warning}>
        ⚠ Auto-trader is in <strong>PAPER mode</strong> — no real money at risk.
        Change PAPER_TRADING=false in Vercel env vars only after 30+ days of profitable paper results.
      </div>
    </div>
  )
}

// components/RiskGauge.tsx
import styles from './RiskGauge.module.css'

interface Props {
  dailyPnlPct: number
  maxDrawdown: number
  openPositions: number
  maxPositions: number
}

export default function RiskGauge({ dailyPnlPct, maxDrawdown, openPositions, maxPositions }: Props) {
  const drawdownUsed = Math.abs(Math.min(dailyPnlPct, 0)) / maxDrawdown
  const positionsUsed = openPositions / maxPositions

  const gaugeColor = (pct: number) =>
    pct > 0.8 ? 'var(--red)' : pct > 0.5 ? 'var(--amber)' : 'var(--green)'

  return (
    <div className={styles.container}>
      <div className={styles.gauge}>
        <div className={styles.gaugeLabelRow}>
          <span className={styles.label}>DAILY LOSS LIMIT</span>
          <span className={styles.value} style={{ color: gaugeColor(drawdownUsed) }}>
            {(drawdownUsed * 100).toFixed(1)}% used
          </span>
        </div>
        <div className={styles.bar}>
          <div
            className={styles.fill}
            style={{
              width: `${Math.min(drawdownUsed * 100, 100)}%`,
              background: gaugeColor(drawdownUsed),
            }}
          />
          <div className={styles.marker} style={{ left: '80%' }} title="Warning threshold" />
        </div>
        <div className={styles.subtext}>
          Max: {(maxDrawdown * 100).toFixed(0)}% | Daily P&L: {dailyPnlPct > 0 ? '+' : ''}{(dailyPnlPct * 100).toFixed(2)}%
        </div>
      </div>

      <div className={styles.gauge}>
        <div className={styles.gaugeLabelRow}>
          <span className={styles.label}>POSITION SLOTS</span>
          <span className={styles.value} style={{ color: gaugeColor(positionsUsed) }}>
            {openPositions} / {maxPositions}
          </span>
        </div>
        <div className={styles.bar}>
          <div
            className={styles.fill}
            style={{
              width: `${positionsUsed * 100}%`,
              background: gaugeColor(positionsUsed),
            }}
          />
        </div>
      </div>

      {drawdownUsed >= 1 && (
        <div className={styles.circuitBreaker}>
          🚨 CIRCUIT BREAKER ACTIVE — Trading paused
        </div>
      )}
    </div>
  )
}

// components/SignalPanel.tsx
import styles from './SignalPanel.module.css'

interface AISignal {
  action: 'long' | 'short' | 'wait'
  confidence: number
  reasoning: string
  keyFactors: string[]
  risks: string[]
  suggestedLeverage: number
}

interface RiskValidation {
  approved: boolean
  reason?: string
  adjustedSize?: number
  warnings: string[]
}

interface Props {
  signal: AISignal | null
  validation: RiskValidation | null
  loading: boolean
  onExecute: () => void
  mode: 'paper' | 'live'
}

export default function SignalPanel({ signal, validation, loading, onExecute, mode }: Props) {
  if (loading) {
    return (
      <div className={styles.panel}>
        <div className={styles.loading}>
          <span className="pulse">⬛</span>
          <span className="pulse" style={{ animationDelay: '0.2s' }}>⬛</span>
          <span className="pulse" style={{ animationDelay: '0.4s' }}>⬛</span>
          <span className={styles.loadingText}>Analysing market conditions...</span>
        </div>
      </div>
    )
  }

  if (!signal) {
    return (
      <div className={styles.panel}>
        <p className={styles.empty}>Click "Analyse" to generate a signal</p>
      </div>
    )
  }

  const actionColor = signal.action === 'long' ? 'green' : signal.action === 'short' ? 'red' : 'amber'
  const actionLabel = signal.action === 'long' ? '▲ LONG' : signal.action === 'short' ? '▼ SHORT' : '— WAIT'

  return (
    <div className={`${styles.panel} fade-up`}>
      <div className={styles.header}>
        <div className={styles.action}>
          <span className={`${styles.actionBadge} ${styles[actionColor]}`}>{actionLabel}</span>
          <span className={styles.confidence}>
            {(signal.confidence * 100).toFixed(1)}% confidence
          </span>
        </div>
        <div className={styles.leverageBadge}>
          {signal.suggestedLeverage}x
        </div>
      </div>

      {/* Confidence bar */}
      <div className={styles.confBar}>
        <div
          className={`${styles.confFill} ${styles[actionColor]}`}
          style={{ width: `${signal.confidence * 100}%` }}
        />
      </div>

      {/* AI Reasoning */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>AI REASONING</span>
        <p className={styles.reasoning}>{signal.reasoning}</p>
      </div>

      {/* Key factors */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>KEY FACTORS</span>
        <ul className={styles.list}>
          {signal.keyFactors.map((f, i) => (
            <li key={i} className={styles.factorItem}>
              <span className={`${styles.dot} text-green`}>◆</span> {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Risks */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>RISKS</span>
        <ul className={styles.list}>
          {signal.risks.map((r, i) => (
            <li key={i} className={styles.riskItem}>
              <span className={`${styles.dot} text-red`}>◆</span> {r}
            </li>
          ))}
        </ul>
      </div>

      {/* Validation result */}
      {validation && (
        <div className={`${styles.validation} ${validation.approved ? styles.approved : styles.rejected}`}>
          {validation.approved ? (
            <>
              <span>✓ Risk check passed</span>
              {validation.warnings.map((w, i) => (
                <div key={i} className={styles.warning}>⚠ {w}</div>
              ))}
            </>
          ) : (
            <span>✗ {validation.reason}</span>
          )}
        </div>
      )}

      {/* Execute button */}
      {signal.action !== 'wait' && validation?.approved && (
        <button className={`${styles.executeBtn} ${styles[actionColor]}`} onClick={onExecute}>
          {mode === 'paper' ? '📋 PAPER TRADE' : '⚡ EXECUTE LIVE'}
          {mode === 'live' && <span className={styles.liveWarning}> — REAL MONEY</span>}
        </button>
      )}
    </div>
  )
}

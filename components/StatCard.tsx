// components/StatCard.tsx
import styles from './StatCard.module.css'

interface Props {
  label: string
  value: string
  sub?: string
  accent?: 'green' | 'red' | 'amber' | 'blue' | 'default'
  pulse?: boolean
}

export default function StatCard({ label, value, sub, accent = 'default', pulse }: Props) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <span className={`${styles.value} ${styles[accent]} ${pulse ? 'pulse' : ''}`}>
        {value}
      </span>
      {sub && <span className={styles.sub}>{sub}</span>}
    </div>
  )
}

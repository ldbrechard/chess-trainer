import { useI18n } from '../../../i18n'

export function SummaryBlock({ total, passed, failed }: { total: number; passed: number; failed: number }) {
  const { t } = useI18n()
  const played = total
  const success = Math.max(0, total - failed)
  const pct = total === 0 ? 0 : Math.round((success / total) * 100)
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">{t({ en: 'Positions played', fr: 'Positions jouées' })}</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{played}</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">{t({ en: 'Success', fr: 'Réussite' })}</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{pct}%</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">{t({ en: 'Passed', fr: 'Passées' })}</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{passed}</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">Fails</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{failed}</div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'

import { useI18n } from '../../../i18n'
import { formatDurationMs } from '../buildHelpers'

export function PuzzleSessionTimer({ startedAtMs, averageMs }: { startedAtMs: number | null; averageMs: number }) {
  const { t } = useI18n()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [startedAtMs])

  const elapsed = startedAtMs == null ? 0 : Math.max(0, nowMs - startedAtMs)
  return (
    <div className="mt-1.5 text-left text-[10px] opacity-80">
      {t({ en: 'Puzzle time', fr: 'Temps puzzle' })}: <span className="font-mono">{formatDurationMs(elapsed)}</span>
      <span className="mx-1.5">·</span>
      {t({ en: 'Session average', fr: 'Moyenne session' })}: <span className="font-mono">{formatDurationMs(averageMs)}</span>
    </div>
  )
}

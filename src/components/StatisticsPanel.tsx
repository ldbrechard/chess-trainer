import { useCallback, useEffect, useMemo, useState } from 'react'
import { listRepertoires } from '../db/repertoireRepo'
import {
  computeAggregateStats,
  computeCurrentStreak,
  computeMovesPerDayLastDays,
  type DayMoveCount,
} from '../db/trainStatsRepo'
import type { Repertoire } from '../db/schema'
import { useI18n } from '../i18n'

type FilterId = 'all' | string

const HISTOGRAM_DAYS = 21
const CHART_H = 72

function MovesPerDayHistogram({ data, locale, t }: { data: DayMoveCount[]; locale: string; t: ReturnType<typeof useI18n>['t'] }) {
  const maxMoves = useMemo(() => Math.max(1, ...data.map((d) => d.moves)), [data])

  return (
    <div className="mt-2">
      <div
        className="flex items-end gap-px rounded border border-[var(--border)] bg-[var(--bg)] px-1 pb-1 pt-2"
        style={{ height: CHART_H + 8 }}
        role="img"
        aria-label="Histogramme des coups joués par jour"
      >
        {data.map((d) => {
          const barH =
            d.moves === 0 ? 2 : Math.max(4, Math.round((d.moves / maxMoves) * CHART_H))
          const tip = new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }).format(new Date(`${d.dayKey}T12:00:00`))
          const moveLabel = d.moves === 1 ? t({ en: '1 move', fr: '1 coup' }) : t({ en: '{count} moves', fr: '{count} coups' }, { count: d.moves })
          return (
            <div key={d.dayKey} className="flex min-w-0 flex-1 flex-col justify-end" title={`${tip} — ${moveLabel}`}>
              <div
                className="mx-auto w-[85%] max-w-[10px] min-w-[2px] rounded-[1px] bg-[var(--accent)] opacity-85"
                style={{ height: barH }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wide text-[var(--text)] opacity-80">
        <span>
          {new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(
            new Date(`${data[0]?.dayKey ?? ''}T12:00:00`),
          )}
        </span>
        <span>{t({ en: 'Today', fr: "Aujourd'hui" })}</span>
      </div>
    </div>
  )
}

export function StatisticsPanel({ onClose }: { onClose: () => void }) {
  const { language, t } = useI18n()
  const locale = language === 'fr' ? 'fr-FR' : 'en-US'
  const [repertoires, setRepertoires] = useState<Repertoire[]>([])
  const [filter, setFilter] = useState<FilterId>('all')
  const [streak, setStreak] = useState<number | null>(null)
  const [agg, setAgg] = useState<{ totalRuns: number; totalMovesPlayed: number; avgSuccessRatePerRun: number | null } | null>(
    null,
  )
  const [perDay, setPerDay] = useState<DayMoveCount[]>([])

  const load = useCallback(async () => {
    const reps = await listRepertoires()
    setRepertoires(reps)
    const f = filter
    const [s, a, daySeries] = await Promise.all([
      computeCurrentStreak(),
      computeAggregateStats({ repertoireId: f }),
      computeMovesPerDayLastDays({ repertoireId: f }, HISTOGRAM_DAYS),
    ])
    setStreak(s)
    setAgg(a)
    setPerDay(daySeries)
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const pct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)} %`)

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 p-6 pt-16">
      <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 text-left text-[var(--text-h)] shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold">{t({ en: 'Statistics', fr: 'Statistiques' })}</h3>
          <button type="button" className="counter text-sm" onClick={onClose} aria-label={t({ en: 'Close', fr: 'Fermer' })}>
            ✕
          </button>
        </div>

        <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--social-bg)] px-3 py-3 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t({ en: 'Current streak', fr: 'Série actuelle' })}</div>
          <div className="mt-1 font-mono text-base text-[var(--text-h)]">
            {streak === null ? '…' : t({ en: '{count} day(s)', fr: '{count} jour(s)' }, { count: streak })}
          </div>
          <p className="mt-2 text-xs opacity-75">
            {t({
              en: 'Consecutive days with at least one training activity.',
              fr: "Jours consécutifs avec au moins une activité en entraînement.",
            })}
          </p>
        </div>

        <label className="mt-4 block text-xs font-medium text-[var(--text-h)]" htmlFor="stats-rep-filter">
          {t({ en: 'Repertoire', fr: 'Répertoire' })}
        </label>
        <select
          id="stats-rep-filter"
          className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterId)}
        >
          <option value="all">{t({ en: 'All', fr: 'Tous' })}</option>
          {repertoires.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title} ({r.side})
            </option>
          ))}
        </select>

        {agg ? (
          <div className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-md border border-[var(--border)] p-3">
              <div className="opacity-80">{t({ en: 'Recorded runs', fr: 'Runs enregistrés' })}</div>
              <div className="mt-1 font-mono">{agg.totalRuns}</div>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3">
              <div className="opacity-80">{t({ en: 'Moves played', fr: 'Coups joués' })}</div>
              <div className="mt-1 font-mono">{agg.totalMovesPlayed}</div>
            </div>
            <div className="rounded-md border border-[var(--border)] p-3 sm:col-span-2">
              <div className="opacity-80">{t({ en: 'Average success rate per run', fr: 'Taux moyen de réussite par run' })}</div>
              <div className="mt-1 font-mono">{pct(agg.avgSuccessRatePerRun)}</div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm opacity-80">{t({ en: 'Loading…', fr: 'Chargement…' })}</p>
        )}

        <div className="mt-5">
          <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t({ en: 'Moves per day', fr: 'Coups par jour' })}</div>
          <p className="mt-1 text-xs opacity-70">
            {t(
              {
                en: 'Total moves recorded over the last {days} days (run end).',
                fr: 'Total des coups enregistrés sur {days} jours (fin de run).',
              },
              { days: HISTOGRAM_DAYS },
            )}
          </p>
          {perDay.length === 0 ? (
            <p className="mt-3 text-sm opacity-75">{t({ en: 'Loading…', fr: 'Chargement…' })}</p>
          ) : (
            <MovesPerDayHistogram data={perDay} locale={locale} t={t} />
          )}
        </div>

        <button type="button" className="counter mt-6" onClick={onClose}>
          {t({ en: 'Close', fr: 'Fermer' })}
        </button>
      </div>
    </div>
  )
}

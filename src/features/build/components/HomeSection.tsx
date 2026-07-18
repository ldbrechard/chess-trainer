import { Download, Flame, Pencil, Share2, Trash2 } from 'lucide-react'

import type { Repertoire } from '../../../db/schema'
import { useI18n } from '../../../i18n'
import type { RepertoireCounts } from '../buildTypes'

export function HomeSection({
  title,
  sectionColorDot,
  repertoires,
  repertoireCounts,
  onOpen,
  onExportPgn,
  onShare,
  onRename,
  onDelete,
}: {
  title: string
  sectionColorDot: 'white' | 'black'
  repertoires: Repertoire[]
  repertoireCounts: RepertoireCounts
  onOpen: (id: string) => void
  onExportPgn: (id: string) => void | Promise<void>
  onShare: (id: string, title: string) => void
  onRename: (repertoire: Repertoire) => void
  onDelete: (repertoire: Repertoire) => void
}) {
  const { t } = useI18n()
  return (
    <section>
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-h)]">
        <span
          className={[
            'h-2 w-2 shrink-0 rounded-full border',
            sectionColorDot === 'white'
              ? 'border-neutral-400 bg-white shadow-sm'
              : 'border-neutral-800 bg-neutral-900 dark:border-neutral-600 dark:bg-neutral-950',
          ].join(' ')}
          aria-hidden
        />
        <span>{title}</span>
      </div>
      <div className="mt-3 space-y-2">
        {repertoires.length === 0 ? (
          <div className="text-sm opacity-80">{t({ en: 'No repertoire.', fr: 'Aucun répertoire.' })}</div>
        ) : (
          repertoires.map((r) => (
            <div
              key={r.id}
              className="flex min-w-0 items-stretch gap-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)] hover:shadow-[var(--shadow)]"
            >
              <div
                className="flex min-w-0 flex-1 cursor-pointer flex-col px-3 py-2 text-left"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onOpen(r.id)
                }}
                aria-label={t({ en: 'Open {title}', fr: 'Ouvrir {title}' }, { title: r.title })}
              >
                <div className="min-w-0 truncate text-left text-sm font-medium text-[var(--text-h)]">{r.title}</div>
                {r.description ? <div className="truncate text-xs italic opacity-70">{r.description}</div> : null}
                <div className="mt-0.5 w-full text-left text-xs opacity-80 hover:opacity-100">
                  {t(
                    { en: '{count} saved positions', fr: '{count} positions enregistrées' },
                    { count: repertoireCounts[r.id] ?? 0 },
                  )}
                </div>
              </div>
              <div
                className={[
                  'flex shrink-0 items-center justify-center',
                  r.trainStreak != null && r.trainStreak > 0 ? 'min-w-[2.25rem] px-1' : 'w-0 min-w-0 overflow-hidden p-0',
                ].join(' ')}
              >
                {r.trainStreak != null && r.trainStreak > 0 ? (
                  <span
                    className="relative inline-flex h-8 w-7 shrink-0 items-end justify-center text-[var(--accent)]"
                    title={t(
                      { en: 'Streak: {count} day(s) in a row', fr: 'Série : {count} jour(s) consécutif(s)' },
                      { count: r.trainStreak },
                    )}
                  >
                    <Flame className="h-8 w-8 shrink-0" fill="currentColor" stroke="none" aria-hidden />
                    <span className="pointer-events-none absolute bottom-[5px] left-1/2 -translate-x-1/2 text-[10px] font-bold leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)] tabular-nums">
                      {r.trainStreak}
                    </span>
                  </span>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-row items-start gap-0.5 self-start pl-2 pr-3 pt-2.5">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                  aria-label={t({ en: 'Rename {title}', fr: 'Renommer {title}' }, { title: r.title })}
                  title={t({ en: 'Rename', fr: 'Renommer' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRename(r)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-red-500/15 hover:text-red-600 hover:opacity-100 dark:hover:text-red-400"
                  aria-label={t({ en: 'Delete {title}', fr: 'Supprimer {title}' }, { title: r.title })}
                  title={t({ en: 'Delete repertoire', fr: 'Supprimer le répertoire' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(r)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              <div className="flex shrink-0 flex-col justify-center gap-0.5 border-l border-[var(--border)] px-0.5 py-1">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                  aria-label={t({ en: 'Download {title} as PGN', fr: 'Télécharger {title} en PGN' }, { title: r.title })}
                  title={t({ en: 'Download PGN', fr: 'Télécharger PGN' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    void onExportPgn(r.id)
                  }}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                  aria-label={t({ en: 'Share {title}', fr: 'Partager {title}' }, { title: r.title })}
                  title={t({ en: 'Share', fr: 'Partager' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onShare(r.id, r.title)
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

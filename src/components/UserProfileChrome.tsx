import { useCallback, useEffect, useState } from 'react'
import { listRepertoires } from '../db/repertoireRepo'
import { SUPPORTED_LANGUAGES, type AppLanguage, useI18n } from '../i18n'
import { useAppSync } from '../sync/useAppSync'
import { StatisticsPanel } from './StatisticsPanel'
import { SyncCloudIndicator } from './SyncCloudIndicator'

function formatAccountDate(iso: string | undefined, locale: string): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(d)
  } catch {
    return '—'
  }
}

function formatLastSyncAt(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

function syncStatusLabel(
  s: ReturnType<typeof useAppSync>,
  locale: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  if (!s.supabaseConfigured) return t({ en: 'Local storage only (no cloud).', fr: 'Stockage local uniquement (pas de cloud).' })
  if (!s.online) return t({ en: 'Offline — sync will resume with network.', fr: 'Hors ligne — la sync reprendra avec le réseau.' })
  if (s.session === undefined) return t({ en: 'Session…', fr: 'Session…' })
  if (!s.session) return t({ en: 'Not connected to cloud.', fr: 'Non connecté au cloud.' })
  if (s.syncRunning) return t({ en: 'Synchronization in progress…', fr: 'Synchronisation en cours…' })
  if (s.lastSyncError) return t({ en: 'Error: {error}', fr: 'Erreur : {error}' }, { error: s.lastSyncError })
  if (s.lastSyncedAt != null)
    return t(
      { en: 'Last successful sync: {date}.', fr: 'Dernière synchronisation réussie : {date}.' },
      { date: formatLastSyncAt(s.lastSyncedAt, locale) },
    )
  return t({ en: 'Connected — waiting for first sync.', fr: 'Connecté — en attente de première sync.' })
}

type UserProfileChromeProps = {
  /** `fixed` : coins supérieurs droits (plein écran). `inline` : dans le flux de la page. */
  placement?: 'fixed' | 'inline'
}

export function UserProfileChrome({ placement = 'fixed' }: UserProfileChromeProps) {
  const { language, setLanguage, t } = useI18n()
  const locale = language === 'fr' ? 'fr-FR' : 'en-US'
  const s = useAppSync()
  const [open, setOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [repCount, setRepCount] = useState<number | null>(null)

  const refreshRepCount = useCallback(() => {
    void listRepertoires().then((r) => setRepCount(r.length))
  }, [])

  useEffect(() => {
    if (!open) return
    refreshRepCount()
  }, [open, refreshRepCount])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const user = s.session?.user
  const displayName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    user?.email?.trim() ||
    (s.supabaseConfigured ? t({ en: 'Not connected', fr: 'Non connecté' }) : t({ en: 'Local mode', fr: 'Mode local' }))

  const barClass =
    placement === 'fixed'
      ? 'pointer-events-auto fixed right-4 top-4 z-[60] flex items-center gap-1.5'
      : 'flex items-center gap-1.5'

  return (
    <>
      <div className={barClass}>
        <SyncCloudIndicator />
        <button
          type="button"
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--social-bg)] text-[var(--text-h)] shadow-[var(--shadow)] hover:bg-[var(--accent-bg)]"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={t({ en: 'Profile menu', fr: 'Menu profil' })}
          title={t({ en: 'Profile', fr: 'Profil' })}
          onClick={() => setOpen((v) => !v)}
        >
          <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        </button>
      </div>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[58] cursor-default bg-transparent"
            aria-label={t({ en: 'Close menu', fr: 'Fermer le menu' })}
            onClick={() => setOpen(false)}
          />
          <aside
            className="profile-drawer fixed right-0 top-0 z-[59] flex h-full w-full max-w-sm flex-col border-l border-[var(--border)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label={t({ en: 'User menu', fr: 'Menu utilisateur' })}
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--text-h)]">{t({ en: 'Profile', fr: 'Profil' })}</h2>
              <button type="button" className="counter text-sm" onClick={() => setOpen(false)} aria-label={t({ en: 'Close', fr: 'Fermer' })}>
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 text-left text-sm text-[var(--text-h)]">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t({ en: 'Name', fr: 'Nom' })}</div>
                <div className="mt-1 font-medium">{displayName}</div>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t({ en: 'Sync', fr: 'Synchronisation' })}</div>
                <p className="mt-1 text-sm leading-relaxed opacity-90">{syncStatusLabel(s, locale, t)}</p>
                {s.supabaseConfigured && s.session ? (
                  <button
                    type="button"
                    className="counter mt-3 text-xs"
                    disabled={s.syncRunning || !s.online}
                    onClick={() => void s.syncNow()}
                  >
                    {s.syncRunning ? t({ en: 'Sync…', fr: 'Sync…' }) : t({ en: 'Sync now', fr: 'Synchroniser maintenant' })}
                  </button>
                ) : null}
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t({ en: 'Account created', fr: 'Compte créé le' })}</div>
                <div className="mt-1">{s.supabaseConfigured && user ? formatAccountDate(user.created_at, locale) : '—'}</div>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">{t({ en: 'Repertoires', fr: 'Répertoires' })}</div>
                <div className="mt-1 font-mono">{repCount === null ? '…' : repCount}</div>
              </div>

              <div>
                <label className="text-xs font-medium uppercase tracking-wide opacity-60" htmlFor="profile-language-select">
                  {t({ en: 'Language', fr: 'Langue' })}
                </label>
                <select
                  id="profile-language-select"
                  className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                >
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang} value={lang}>
                      {lang === 'en' ? 'English' : 'Français'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
                <button type="button" className="counter w-full" onClick={() => setStatsOpen(true)}>
                  {t({ en: 'Statistics', fr: 'Statistiques' })}
                </button>
                {s.supabaseConfigured && s.session ? (
                  <button
                    type="button"
                    className="counter w-full"
                    onClick={() => {
                      setOpen(false)
                      void s.signOutCloud()
                    }}
                  >
                    {t({ en: 'Log out', fr: 'Se déconnecter' })}
                  </button>
                ) : s.supabaseConfigured && s.session === null ? (
                  <button
                    type="button"
                    className="counter w-full"
                    onClick={() => {
                      setOpen(false)
                      s.openAuthModal()
                    }}
                  >
                    {t({ en: 'Cloud sign in', fr: 'Connexion cloud' })}
                  </button>
                ) : null}
              </div>
            </div>
          </aside>
        </>
      ) : null}

      {statsOpen ? <StatisticsPanel onClose={() => setStatsOpen(false)} /> : null}
    </>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { listRepertoires } from '../db/repertoireRepo'
import { useAppSync } from '../sync/useAppSync'
import { StatisticsPanel } from './StatisticsPanel'
import { SyncCloudIndicator } from './SyncCloudIndicator'

function formatAccountDate(iso: string | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(d)
  } catch {
    return '—'
  }
}

function formatLastSyncAt(ms: number): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(ms))
}

function syncStatusLabel(s: ReturnType<typeof useAppSync>): string {
  if (!s.supabaseConfigured) return 'Stockage local uniquement (pas de cloud).'
  if (!s.online) return 'Hors ligne — la sync reprendra avec le réseau.'
  if (s.session === undefined) return 'Session…'
  if (!s.session) return 'Non connecté au cloud.'
  if (s.syncRunning) return 'Synchronisation en cours…'
  if (s.lastSyncError) return `Erreur : ${s.lastSyncError}`
  if (s.lastSyncedAt != null)
    return `Dernière synchronisation réussie : ${formatLastSyncAt(s.lastSyncedAt)}.`
  return 'Connecté — en attente de première sync.'
}

type UserProfileChromeProps = {
  /** `fixed` : coins supérieurs droits (plein écran). `inline` : dans le flux de la page. */
  placement?: 'fixed' | 'inline'
}

export function UserProfileChrome({ placement = 'fixed' }: UserProfileChromeProps) {
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
    (s.supabaseConfigured ? 'Non connecté' : 'Mode local')

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
          aria-label="Menu profil"
          title="Profil"
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
            aria-label="Fermer le menu"
            onClick={() => setOpen(false)}
          />
          <aside
            className="profile-drawer fixed right-0 top-0 z-[59] flex h-full w-full max-w-sm flex-col border-l border-[var(--border)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Menu utilisateur"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--text-h)]">Profil</h2>
              <button type="button" className="counter text-sm" onClick={() => setOpen(false)} aria-label="Fermer">
                ✕
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 text-left text-sm text-[var(--text-h)]">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">Nom</div>
                <div className="mt-1 font-medium">{displayName}</div>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">Synchronisation</div>
                <p className="mt-1 text-sm leading-relaxed opacity-90">{syncStatusLabel(s)}</p>
                {s.supabaseConfigured && s.session ? (
                  <button
                    type="button"
                    className="counter mt-3 text-xs"
                    disabled={s.syncRunning || !s.online}
                    onClick={() => void s.syncNow()}
                  >
                    {s.syncRunning ? 'Sync…' : 'Synchroniser maintenant'}
                  </button>
                ) : null}
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">Compte créé le</div>
                <div className="mt-1">{s.supabaseConfigured && user ? formatAccountDate(user.created_at) : '—'}</div>
              </div>

              <div>
                <div className="text-xs font-medium uppercase tracking-wide opacity-60">Répertoires</div>
                <div className="mt-1 font-mono">{repCount === null ? '…' : repCount}</div>
              </div>

              <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-4">
                <button type="button" className="counter w-full" onClick={() => setStatsOpen(true)}>
                  Statistiques
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
                    Log out
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
                    Connexion cloud
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

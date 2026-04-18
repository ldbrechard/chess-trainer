import type { ReactNode } from 'react'
import { useAppSync } from '../sync/useAppSync'

/** Icône nuage discret : hors ligne / sync / OK / erreur */
export function SyncCloudIndicator() {
  const s = useAppSync()

  let title = 'Stockage local'
  let icon: ReactNode = (
    <span className="text-[14px] leading-none opacity-40" aria-hidden>
      ☁
    </span>
  )
  let tone = 'text-[var(--text-h)] opacity-50'

  if (s.supabaseConfigured) {
    if (!s.online) {
      title = 'Hors ligne — synchronisation au retour du réseau'
      icon = (
        <span className="text-[14px] leading-none opacity-45" aria-hidden>
          ☁
        </span>
      )
      tone = 'text-amber-800/70 dark:text-amber-200/70'
    } else if (s.syncRunning) {
      title = 'Synchronisation en cours…'
      icon = (
        <span className="inline-block animate-spin text-[13px] leading-none opacity-70" aria-hidden>
          ⟳
        </span>
      )
      tone = 'text-[var(--accent)] opacity-80'
    } else if (s.lastSyncError) {
      title = `Erreur de sync : ${s.lastSyncError}`
      icon = (
        <span className="text-[14px] leading-none opacity-55" aria-hidden>
          ☁
        </span>
      )
      tone = 'text-red-700/75 dark:text-red-300/75'
    } else if (s.session) {
      title = s.lastSyncedAt ? 'Synchronisé' : 'Cloud prêt'
      icon = (
        <span className="text-[14px] leading-none opacity-45" aria-hidden>
          ☁
        </span>
      )
      tone = 'text-emerald-800/65 dark:text-emerald-200/65'
    } else {
      title = 'En ligne — connecte-toi au cloud pour synchroniser'
      icon = (
        <span className="text-[14px] leading-none opacity-38" aria-hidden>
          ☁
        </span>
      )
    }
  }

  return (
    <span
      className={`inline-flex flex-shrink-0 items-center justify-center px-0.5 py-0.5 ${tone}`}
      title={title}
      role="img"
      aria-label={title}
    >
      {icon}
    </span>
  )
}

import { Mail, Smartphone } from 'lucide-react'

type Props = {
  open: boolean
  repertoireTitle: string
  onClose: () => void
}

export function ShareRepertoireModal({ open, repertoireTitle, onClose }: Props) {
  if (!open) return null

  const btnClass =
    'inline-flex flex-col items-center gap-1 rounded-md border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-h)] opacity-40 cursor-not-allowed'

  return (
    <div
      className="fixed inset-0 z-[76] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-24"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 text-left text-[var(--text-h)] shadow-lg" role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold">Partager</h3>
          <button type="button" className="counter text-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm opacity-80">
          « <span className="font-medium">{repertoireTitle}</span> » — canaux à brancher plus tard.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <button type="button" className={btnClass} disabled title="Bientôt disponible">
            <Mail className="h-5 w-5" aria-hidden />
            Mail
          </button>
          <button type="button" className={btnClass} disabled title="Bientôt disponible">
            <Smartphone className="h-5 w-5" aria-hidden />
            App
          </button>
          <button type="button" className={btnClass} disabled title="Bientôt disponible">
            <span className="text-lg font-bold leading-none" aria-hidden>
              f
            </span>
            Facebook
          </button>
          <button type="button" className={btnClass} disabled title="Bientôt disponible">
            <span className="text-lg font-bold leading-none" aria-hidden>
              W
            </span>
            WhatsApp
          </button>
        </div>
      </div>
    </div>
  )
}

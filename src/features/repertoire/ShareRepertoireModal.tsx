import { Copy, ExternalLink, Share2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getRepertoire, listAllMoves } from '../../db/repertoireRepo'
import { useI18n } from '../../i18n'
import { exportRepertoireToPgn } from '../../lib/pgnImportExport'
import { createSharedRepertoireLink } from '../../lib/sharedRepertoireRepo'
import { isSupabaseConfigured } from '../../lib/supabaseClient'

type Props = {
  open: boolean
  repertoireId: string
  repertoireTitle: string
  onClose: () => void
}

export function ShareRepertoireModal({ open, repertoireId, repertoireTitle, onClose }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const supabaseReady = useMemo(() => isSupabaseConfigured(), [])

  useEffect(() => {
    if (!open) return
    if (!supabaseReady) {
      setError(t({ en: 'Cloud is not configured.', fr: "Le cloud n'est pas configuré." }))
      setShareUrl(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setShareUrl(null)
    void (async () => {
      try {
        const rep = await getRepertoire(repertoireId)
        if (!rep) throw new Error(t({ en: 'Repertoire not found.', fr: 'Répertoire introuvable.' }))
        const moves = await listAllMoves(repertoireId)
        const pgnText = exportRepertoireToPgn(rep, moves)
        const url = await createSharedRepertoireLink({
          title: rep.title,
          side: rep.side,
          pgnText,
          expiresInDays: 30,
        })
        if (!cancelled) setShareUrl(url)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, repertoireId, supabaseReady, t])

  if (!open) return null

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
          <h3 className="text-base font-semibold">{t({ en: 'Share', fr: 'Partager' })}</h3>
          <button type="button" className="counter text-sm" onClick={onClose} aria-label={t({ en: 'Close', fr: 'Fermer' })}>
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm opacity-80">
          {t(
            {
              en: '“{title}” — share this link to import in another app.',
              fr: '« {title} » — partage ce lien pour importer dans une autre app.',
            },
            { title: repertoireTitle },
          )}
        </p>
        {loading ? <p className="mt-4 text-sm opacity-80">{t({ en: 'Generating link…', fr: 'Génération du lien…' })}</p> : null}
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        {shareUrl ? (
          <div className="mt-4 space-y-3">
            <div className="break-all rounded-md border border-[var(--border)] bg-[var(--code-bg)] px-3 py-2 text-xs">
              {shareUrl}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                className="counter mb-0 inline-flex items-center justify-center gap-1 text-xs"
                onClick={() => void navigator.clipboard.writeText(shareUrl)}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                {t({ en: 'Copy', fr: 'Copier' })}
              </button>
              <a
                className="counter mb-0 inline-flex items-center justify-center gap-1 text-xs"
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                {t({ en: 'Open', fr: 'Ouvrir' })}
              </a>
              <button
                type="button"
                className="counter mb-0 inline-flex items-center justify-center gap-1 text-xs"
                onClick={() => {
                  if (navigator.share) {
                    void navigator.share({
                      title: repertoireTitle,
                      text: t({ en: 'Open this repertoire in Chess Trainer', fr: 'Ouvre ce répertoire dans Chess Trainer' }),
                      url: shareUrl,
                    })
                    return
                  }
                  void navigator.clipboard.writeText(shareUrl)
                }}
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                {t({ en: 'Share', fr: 'Partager' })}
              </button>
            </div>
            <p className="text-xs opacity-75">
              {t(
                {
                  en: 'If the app is installed, opening this link should launch it directly; otherwise the web page offers install/import.',
                  fr: "Si l'app est installée, ce lien l'ouvrira directement ; sinon la page web proposera installation/import.",
                },
              )}
            </p>
          </div>
        ) : null}
        <div className="mt-4 flex justify-end">
          <button type="button" className="counter mb-0 text-xs" onClick={onClose}>
            {t({ en: 'Done', fr: 'Terminé' })}
          </button>
        </div>
      </div>
    </div>
  )
}

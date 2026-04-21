import { useEffect, useMemo, useState } from 'react'
import { bulkInsertMovesForRepertoire, createRepertoire } from '../db/repertoireRepo'
import type { Side } from '../db/schema'
import { useI18n } from '../i18n'
import { tryBuildImportPreview } from '../lib/pgnImportExport'
import { fetchSharedRepertoireById } from '../lib/sharedRepertoireRepo'

type Props = {
  shareId: string
  onOpenApp: () => void
}

type PromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

export function SharedRepertoirePage({ shareId, onOpenApp }: Props) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [side, setSide] = useState<Side>('white')
  const [pgnText, setPgnText] = useState('')
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<PromptEvent | null>(null)
  const isStandalone = useMemo(
    () =>
      (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
      (typeof navigator !== 'undefined' && (navigator as Navigator & { standalone?: boolean }).standalone === true),
    [],
  )

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as PromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt as EventListener)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const row = await fetchSharedRepertoireById(shareId)
        if (!row || row.revoked) {
          setError(t({ en: 'This shared repertoire is unavailable.', fr: 'Ce répertoire partagé est indisponible.' }))
          return
        }
        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
          setError(t({ en: 'This shared link has expired.', fr: 'Ce lien partagé a expiré.' }))
          return
        }
        if (!cancelled) {
          setTitle(row.repertoire_title)
          setSide(row.side)
          setPgnText(row.pgn_text)
        }
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
  }, [shareId, t])

  const handleImport = async () => {
    if (!pgnText.trim()) return
    const parsed = tryBuildImportPreview(pgnText)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setImporting(true)
    setError(null)
    try {
      const repId = await createRepertoire({
        title: (title || parsed.preview.suggestedTitle || 'Shared repertoire').slice(0, 80),
        side,
      })
      await bulkInsertMovesForRepertoire(repId, parsed.preview.rows)
      setImported(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl p-4 pt-10 text-left text-[var(--text-h)]">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 shadow-[var(--shadow)]">
        <h1 className="text-2xl font-semibold">{t({ en: 'Shared repertoire', fr: 'Répertoire partagé' })}</h1>
        {loading ? <p className="mt-3 text-sm opacity-80">{t({ en: 'Loading…', fr: 'Chargement…' })}</p> : null}
        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {!loading && !error ? (
          <>
            <p className="mt-3 text-sm">
              {t({ en: 'Title', fr: 'Titre' })}: <span className="font-medium">{title}</span>
            </p>
            <p className="mt-1 text-sm">
              {t({ en: 'Side', fr: 'Couleur' })}: {side === 'white' ? t({ en: 'White', fr: 'Blancs' }) : t({ en: 'Black', fr: 'Noirs' })}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="counter mb-0 text-sm" onClick={handleImport} disabled={importing || imported}>
                {importing
                  ? t({ en: 'Importing…', fr: 'Import…' })
                  : imported
                    ? t({ en: 'Imported', fr: 'Importé' })
                    : t({ en: 'Import in app', fr: "Importer dans l'app" })}
              </button>
              <button type="button" className="counter mb-0 text-sm" onClick={onOpenApp}>
                {t({ en: 'Open app home', fr: "Ouvrir l'app" })}
              </button>
              {!isStandalone && installPrompt ? (
                <button
                  type="button"
                  className="counter mb-0 text-sm"
                  onClick={() => {
                    void (async () => {
                      await installPrompt.prompt()
                      await installPrompt.userChoice
                      setInstallPrompt(null)
                    })()
                  }}
                >
                  {t({ en: 'Install app', fr: "Installer l'app" })}
                </button>
              ) : null}
            </div>
            {!isStandalone ? (
              <p className="mt-3 text-xs opacity-75">
                {t(
                  {
                    en: 'Tip: install the app to open shared links directly in PWA mode.',
                    fr: "Astuce : installe l'app pour ouvrir les liens partagés directement en mode PWA.",
                  },
                )}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}


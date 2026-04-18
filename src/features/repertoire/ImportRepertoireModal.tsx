import { CheckCircle2, Link2, Upload } from 'lucide-react'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { bulkInsertMovesForRepertoire, createRepertoire } from '../../db/repertoireRepo'
import type { Side } from '../../db/schema'
import { fetchLichessStudyPgnText, studyPageUrlToPgnFetchUrl } from '../../lib/lichessStudyPgn'
import { tryBuildImportPreview, type PgnImportPreview } from '../../lib/pgnImportExport'

type Step = 'source' | 'preview'

const PGN_HELP =
  'Chess.com : ouvre la partie ou l’ouverture → menu (⋮) ou « Share » → « Export » / « Copy PGN ». ' +
  'Lichess : partie → bouton de téléchargement sous l’échiquier ; étude → menu « Share » puis « Study PGN » ou copie du lien public.'

type Props = {
  open: boolean
  onClose: () => void
  onImported: (repertoireId: string) => void
}

async function readFileAsUtf8Text(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(typeof r.result === 'string' ? r.result : '')
    r.onerror = () => reject(r.error ?? new Error('FileReader error'))
    r.readAsText(file, 'UTF-8')
  })
}

export function ImportRepertoireModal({ open, onClose, onImported }: Props) {
  const baseId = useId()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('source')
  const [sourceTab, setSourceTab] = useState<'file' | 'url'>('file')
  const [pgnDraft, setPgnDraft] = useState('')
  const [urlDraft, setUrlDraft] = useState('')
  const [fetchingUrl, setFetchingUrl] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [preview, setPreview] = useState<PgnImportPreview | null>(null)
  const [title, setTitle] = useState('')
  const [side, setSide] = useState<Side>('white')
  const [busy, setBusy] = useState(false)

  const reset = useCallback(() => {
    setStep('source')
    setSourceTab('file')
    setPgnDraft('')
    setUrlDraft('')
    setFetchingUrl(false)
    setParseError(null)
    setPreview(null)
    setTitle('')
    setSide('white')
    setBusy(false)
  }, [])

  useEffect(() => {
    if (!open) reset()
  }, [open, reset])

  const pgnForValidation = useMemo(() => {
    if (sourceTab === 'file') return pgnDraft
    return pgnDraft
  }, [sourceTab, pgnDraft])

  useEffect(() => {
    if (!open || step !== 'source') return
    const text = pgnForValidation.trim()
    if (!text) {
      setParseError(null)
      setPreview(null)
      return
    }
    const r = tryBuildImportPreview(text)
    if (r.ok) {
      setParseError(null)
      setPreview(r.preview)
    } else {
      setParseError(r.error)
      setPreview(null)
    }
  }, [open, step, pgnForValidation])

  const valid = Boolean(preview && !parseError)

  const onPickFile: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    try {
      const text = await readFileAsUtf8Text(f)
      setPgnDraft(text)
      setSourceTab('file')
      setParseError(null)
    } catch {
      setParseError('Impossible de lire le fichier.')
    }
  }

  const loadFromUrl = useCallback(async () => {
    const u = urlDraft.trim()
    if (!u) {
      setParseError('Colle une URL d’étude Lichess.')
      return
    }
    if (!studyPageUrlToPgnFetchUrl(u)) {
      setParseError('URL non reconnue (ex. https://lichess.org/study/… ).')
      return
    }
    setFetchingUrl(true)
    setParseError(null)
    try {
      const res = await fetchLichessStudyPgnText(u)
      if (!res.ok) {
        setParseError(res.error)
        setPgnDraft('')
        return
      }
      setPgnDraft(res.text)
      setSourceTab('url')
    } finally {
      setFetchingUrl(false)
    }
  }, [urlDraft])

  const goPreview = () => {
    if (!preview) return
    setTitle(preview.suggestedTitle)
    setStep('preview')
  }

  const confirmImport = async () => {
    if (!preview) return
    const t = title.trim()
    if (!t) return
    setBusy(true)
    setParseError(null)
    try {
      const repId = await createRepertoire({ title: t.slice(0, 80), side })
      await bulkInsertMovesForRepertoire(repId, preview.rows)
      onImported(repId)
      onClose()
    } catch {
      setParseError("Impossible d'enregistrer l'import.")
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-12">
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5 text-left text-[var(--text-h)] shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${baseId}-title`}
      >
        <div className="flex items-start justify-between gap-2">
          <h2 id={`${baseId}-title`} className="text-lg font-semibold">
            Importer un répertoire
          </h2>
          <button type="button" className="counter text-sm" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--text)]">
          <span>Aide export PGN</span>
          <span
            className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[var(--border)] text-[11px] font-semibold text-[var(--text-h)]"
            title={PGN_HELP}
          >
            ?
          </span>
        </div>

        {step === 'source' ? (
          <div className="mt-4 space-y-4">
            <input
              ref={fileInputRef}
              id={`${baseId}-file`}
              type="file"
              accept=".pgn,.PGN,.txt,text/plain,application/x-chess-pgn,application/octet-stream"
              className="sr-only"
              aria-label="Choisir un fichier PGN"
              onChange={onPickFile}
              disabled={busy}
              tabIndex={-1}
            />

            <div className="flex gap-2">
              <label
                htmlFor={`${baseId}-file`}
                className={[
                  'counter flex flex-1 cursor-pointer items-center justify-center gap-1 text-xs',
                  sourceTab === 'file' ? '' : 'opacity-60',
                  busy ? 'pointer-events-none opacity-50' : '',
                ].join(' ')}
                onClick={() => setSourceTab('file')}
              >
                <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
                Upload PGN
              </label>
              <button
                type="button"
                className={`counter flex-1 text-xs ${sourceTab === 'url' ? '' : 'opacity-60'}`}
                onClick={() => setSourceTab('url')}
              >
                <Link2 className="mr-1 inline h-3.5 w-3.5 align-text-bottom" aria-hidden />
                URL Lichess
              </button>
            </div>

            {sourceTab === 'file' ? (
              <div>
                <span className="block text-xs font-medium text-[var(--text-h)]">Fichier PGN</span>
                <button
                  type="button"
                  className="counter mt-2 text-xs"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Parcourir…
                </button>
                <p className="mt-2 text-xs opacity-75">Tu peux aussi coller du PGN ci-dessous après l’avoir ouvert dans un éditeur.</p>
                <textarea
                  className="mt-2 min-h-[120px] w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 font-mono text-xs"
                  placeholder="Coller le PGN ici…"
                  value={pgnDraft}
                  onChange={(e) => setPgnDraft(e.target.value)}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-[var(--text-h)]" htmlFor={`${baseId}-url`}>
                  URL d’étude (publique)
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    id={`${baseId}-url`}
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 text-sm"
                    placeholder="https://lichess.org/study/…"
                    value={urlDraft}
                    onChange={(e) => setUrlDraft(e.target.value)}
                    disabled={fetchingUrl}
                  />
                  <button type="button" className="counter shrink-0 text-xs" onClick={() => void loadFromUrl()} disabled={fetchingUrl}>
                    {fetchingUrl ? '…' : 'Charger'}
                  </button>
                </div>
                {pgnDraft && sourceTab === 'url' ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs opacity-80">Voir le PGN chargé</summary>
                    <textarea
                      className="mt-2 max-h-40 w-full rounded-md border border-[var(--border)] bg-[var(--social-bg)] px-2 py-2 font-mono text-[11px]"
                      readOnly
                      value={pgnDraft}
                    />
                  </details>
                ) : null}
              </div>
            )}

            <div className="flex min-h-[28px] items-center gap-2 text-sm">
              {valid ? (
                <>
                  <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden />
                  <span className="text-emerald-800">Format PGN valide ({preview?.moves} coups).</span>
                </>
              ) : parseError ? (
                <span className="text-red-600">{parseError}</span>
              ) : pgnForValidation.trim() ? (
                <span className="opacity-70">Analyse…</span>
              ) : (
                <span className="opacity-60">Choisis un fichier ou charge une URL.</span>
              )}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button type="button" className="counter text-sm" onClick={onClose}>
                Annuler
              </button>
              <button type="button" className="counter text-sm" disabled={!valid} onClick={goPreview}>
                Prévisualiser
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-md border border-[var(--border)] p-2">
                <div className="text-xs opacity-70">Chapitres</div>
                <div className="mt-1 font-mono font-medium">{preview?.chapters ?? '—'}</div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2">
                <div className="text-xs opacity-70">Variantes</div>
                <div className="mt-1 font-mono font-medium">{preview?.variants ?? '—'}</div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2">
                <div className="text-xs opacity-70">Coups</div>
                <div className="mt-1 font-mono font-medium">{preview?.moves ?? '—'}</div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-h)]" htmlFor={`${baseId}-title-in`}>
                Titre
              </label>
              <input
                id={`${baseId}-title-in`}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={80}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-h)]" htmlFor={`${baseId}-side`}>
                Couleur jouée
              </label>
              <select
                id={`${baseId}-side`}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={side}
                onChange={(e) => setSide(e.target.value as Side)}
              >
                <option value="white">Blancs</option>
                <option value="black">Noirs</option>
              </select>
            </div>

            {parseError ? <p className="text-sm text-red-600">{parseError}</p> : null}

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button type="button" className="counter text-sm" onClick={() => setStep('source')} disabled={busy}>
                Retour
              </button>
              <button type="button" className="counter text-sm" disabled={busy || !title.trim()} onClick={() => void confirmImport()}>
                {busy ? 'Import…' : 'Valider l’import'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

import { CheckCircle2, Link2, Upload } from 'lucide-react'
import { useCallback, useEffect, useId, useState } from 'react'
import { bulkInsertMovesForRepertoire, createRepertoire } from '../../db/repertoireRepo'
import type { Side } from '../../db/schema'
import { fetchLichessStudyPgnText, studyPageUrlToPgnFetchUrl } from '../../lib/lichessStudyPgn'
import { useI18n } from '../../i18n'
import { tryBuildImportPreview, type PgnImportPreview } from '../../lib/pgnImportExport'

type Step = 'source' | 'preview'

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

function PgnHelpTooltip({ id }: { id: string }) {
  const { t } = useI18n()
  return (
    <div
      id={id}
      role="tooltip"
      className="pointer-events-none invisible absolute left-0 top-full z-[80] -mt-1 w-[min(100vw-2rem,19rem)] rounded-md border border-neutral-700 bg-black p-2 pt-2.5 text-left text-[10px] leading-snug text-white opacity-0 shadow-lg transition-opacity duration-100 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100"
    >
      <div className="max-h-[min(65vh,22rem)] space-y-2 overflow-y-auto">
        <p className="m-0 font-semibold text-white">{t({ en: 'How to get PGN?', fr: 'Comment obtenir du PGN ?' })}</p>

        <section>
          <h4 className="m-0 font-semibold text-neutral-300">{t({ en: 'File', fr: 'Fichier' })}</h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-neutral-100">
            <li>
              <span className="font-medium text-white">{t({ en: 'Upload PGN', fr: 'Upload PGN' })}</span>{' '}
              {t({ en: 'opens the file picker', fr: 'ouvre le sélecteur' })} (
              <span className="font-mono">.pgn</span> ou texte).
            </li>
            <li>{t({ en: 'You can also paste into the text area.', fr: 'Vous pouvez aussi coller dans la zone de texte.' })}</li>
          </ul>
        </section>

        <section>
          <h4 className="m-0 font-semibold text-neutral-300">{t({ en: 'Lichess — study', fr: 'Lichess — étude' })}</h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-neutral-100">
            <li>
              {t({ en: 'Study → Share menu → copy URL (e.g.', fr: 'Étude → menu Share → copier l’URL (ex.' })}{' '}
              <span className="break-all font-mono text-[9px]">lichess.org/study/…</span>).
            </li>
            <li>
              {t({ en: 'Tab', fr: 'Onglet' })} <span className="font-medium text-white">URL Lichess</span> →{' '}
              {t({ en: 'paste →', fr: 'coller →' })} <span className="font-medium text-white">{t({ en: 'Load', fr: 'Charger' })}</span>.
            </li>
            <li>{t({ en: 'Public link (no account).', fr: 'Lien public (sans compte).' })}</li>
          </ul>
        </section>

        <section>
          <h4 className="m-0 font-semibold text-neutral-300">{t({ en: 'Lichess — game', fr: 'Lichess — partie' })}</h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-neutral-100">
            <li>{t({ en: 'Under the board: download PGN.', fr: 'Sous l’échiquier : téléchargement PGN.' })}</li>
            <li>{t({ en: 'File upload or paste in text area.', fr: 'Fichier ou collage dans la zone.' })}</li>
          </ul>
        </section>

        <section>
          <h4 className="m-0 font-semibold text-neutral-300">Chess.com</h4>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-3.5 text-neutral-100">
            <li>{t({ en: 'Game/opening → menu (⋮) or Share → Export/copy PGN.', fr: 'Partie / ouverture → menu (⋮) ou Share → Export ou copie PGN.' })}</li>
            <li>{t({ en: 'Paste directly or save then Upload PGN.', fr: 'Coller ou enregistrer puis Upload PGN.' })}</li>
          </ul>
        </section>
      </div>
    </div>
  )
}

export function ImportRepertoireModal({ open, onClose, onImported }: Props) {
  const { t } = useI18n()
  const baseId = useId()
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

  const pgnForValidation = pgnDraft

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
      setParseError(t({ en: 'Unable to read file.', fr: 'Impossible de lire le fichier.' }))
    }
  }

  const loadFromUrl = useCallback(async () => {
    const u = urlDraft.trim()
    if (!u) {
      setParseError(t({ en: 'Paste a Lichess study URL.', fr: 'Colle une URL d’étude Lichess.' }))
      return
    }
    if (!studyPageUrlToPgnFetchUrl(u)) {
      setParseError(t({ en: 'Unrecognized URL (e.g. https://lichess.org/study/… ).', fr: 'URL non reconnue (ex. https://lichess.org/study/… ).' }))
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
    const nextTitle = title.trim()
    if (!nextTitle) return
    setBusy(true)
    setParseError(null)
    try {
      const repId = await createRepertoire({ title: nextTitle.slice(0, 80), side })
      await bulkInsertMovesForRepertoire(repId, preview.rows)
      onImported(repId)
      onClose()
    } catch {
      setParseError(t({ en: 'Unable to save import.', fr: "Impossible d'enregistrer l'import." }))
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
            {t({ en: 'Import repertoire', fr: 'Importer un répertoire' })}
          </h2>
          <button type="button" className="counter text-sm" onClick={onClose} aria-label={t({ en: 'Close', fr: 'Fermer' })}>
            ✕
          </button>
        </div>

        <div className="group relative mt-2 flex w-fit items-center gap-1.5 text-xs text-[var(--text)]">
          <span>{t({ en: 'PGN export help', fr: 'Aide export PGN' })}</span>
          <span
            className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full border border-[var(--border)] bg-[var(--bg)] text-[10px] font-semibold text-[var(--text-h)] outline-none ring-offset-2 hover:border-[var(--accent-border)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            tabIndex={0}
            aria-describedby={`${baseId}-pgn-help`}
          >
            ?<span className="sr-only">{t({ en: 'PGN import help', fr: 'Aide import PGN' })}</span>
          </span>
          <PgnHelpTooltip id={`${baseId}-pgn-help`} />
        </div>

        {step === 'source' ? (
          <div className="mt-4 space-y-4">
            <input
              id={`${baseId}-file`}
              type="file"
              accept=".pgn,.PGN,.txt,text/plain,application/x-chess-pgn,application/octet-stream"
              className="sr-only"
              aria-label={t({ en: 'Choose PGN file', fr: 'Choisir un fichier PGN' })}
              onChange={onPickFile}
              disabled={busy}
              tabIndex={-1}
            />

            <div className="flex gap-2">
              <label
                htmlFor={`${baseId}-file`}
                className={[
                  'counter mb-0 flex flex-1 cursor-pointer items-center justify-center gap-1 text-xs',
                  sourceTab === 'file'
                    ? '!border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                    : '!border-[var(--border)] bg-[var(--code-bg)] text-[var(--text-h)]',
                  busy ? 'pointer-events-none opacity-50' : '',
                ].join(' ')}
                onClick={() => setSourceTab('file')}
              >
                <Upload className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t({ en: 'Upload PGN', fr: 'Upload PGN' })}
              </label>
              <button
                type="button"
                className={[
                  'counter mb-0 flex flex-1 items-center justify-center gap-1 text-xs',
                  sourceTab === 'url'
                    ? '!border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]'
                    : '!border-[var(--border)] bg-[var(--code-bg)] text-[var(--text-h)]',
                ].join(' ')}
                onClick={() => setSourceTab('url')}
              >
                <Link2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {t({ en: 'Lichess URL', fr: 'URL Lichess' })}
              </button>
            </div>

            {sourceTab === 'file' ? (
              <div>
                <p className="text-xs text-[var(--text)] opacity-90">
                  {t({ en: 'Paste PGN below if you are not using a file.', fr: 'Collez le PGN ci-dessous si vous ne passez pas par un fichier.' })}
                </p>
                <textarea
                  className="mt-2 min-h-[140px] w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-2 font-mono text-xs"
                  placeholder={t({ en: 'Paste PGN here…', fr: 'Coller le PGN ici…' })}
                  value={pgnDraft}
                  onChange={(e) => setPgnDraft(e.target.value)}
                  spellCheck={false}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-[var(--text-h)]" htmlFor={`${baseId}-url`}>
                  {t({ en: 'Study URL (public)', fr: 'URL d’étude (publique)' })}
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
                    {fetchingUrl ? '…' : t({ en: 'Load', fr: 'Charger' })}
                  </button>
                </div>
                {pgnDraft && sourceTab === 'url' ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs opacity-80">{t({ en: 'View loaded PGN', fr: 'Voir le PGN chargé' })}</summary>
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
                  <span className="text-emerald-800">
                    {t({ en: 'Valid PGN format ({moves} moves).', fr: 'Format PGN valide ({moves} coups).' }, { moves: preview?.moves ?? 0 })}
                  </span>
                </>
              ) : parseError ? (
                <span className="text-red-600">{parseError}</span>
              ) : pgnForValidation.trim() ? (
                <span className="opacity-70">{t({ en: 'Parsing…', fr: 'Analyse…' })}</span>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button type="button" className="counter text-sm" onClick={onClose}>
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button type="button" className="counter text-sm" disabled={!valid} onClick={goPreview}>
                {t({ en: 'Preview', fr: 'Prévisualiser' })}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-md border border-[var(--border)] p-2">
                <div className="text-xs opacity-70">{t({ en: 'Chapters', fr: 'Chapitres' })}</div>
                <div className="mt-1 font-mono font-medium">{preview?.chapters ?? '—'}</div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2">
                <div className="text-xs opacity-70">{t({ en: 'Variations', fr: 'Variantes' })}</div>
                <div className="mt-1 font-mono font-medium">{preview?.variants ?? '—'}</div>
              </div>
              <div className="rounded-md border border-[var(--border)] p-2">
                <div className="text-xs opacity-70">{t({ en: 'Moves', fr: 'Coups' })}</div>
                <div className="mt-1 font-mono font-medium">{preview?.moves ?? '—'}</div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-[var(--text-h)]" htmlFor={`${baseId}-title-in`}>
                {t({ en: 'Title', fr: 'Titre' })}
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
                {t({ en: 'Side to play', fr: 'Couleur jouée' })}
              </label>
              <select
                id={`${baseId}-side`}
                className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={side}
                onChange={(e) => setSide(e.target.value as Side)}
              >
                <option value="white">{t({ en: 'White', fr: 'Blancs' })}</option>
                <option value="black">{t({ en: 'Black', fr: 'Noirs' })}</option>
              </select>
            </div>

            {parseError ? <p className="text-sm text-red-600">{parseError}</p> : null}

            <div className="flex justify-end gap-2 border-t border-[var(--border)] pt-4">
              <button type="button" className="counter text-sm" onClick={() => setStep('source')} disabled={busy}>
                {t({ en: 'Back', fr: 'Retour' })}
              </button>
              <button type="button" className="counter text-sm" disabled={busy || !title.trim()} onClick={() => void confirmImport()}>
                {busy ? t({ en: 'Importing…', fr: 'Import…' }) : t({ en: 'Confirm import', fr: 'Valider l’import' })}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

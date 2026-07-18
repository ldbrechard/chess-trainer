import { useState } from 'react'
import { Check } from 'lucide-react'

import type { Side } from '../../../db/schema'
import { useI18n } from '../../../i18n'
import { ModalFrame } from './ModalFrame'

function CreateRepertoireModalInner({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean
  onClose: () => void
  onSubmit: (title: string, side: Side, description?: string) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [side, setSide] = useState<Side | null>(null)
  const [sideError, setSideError] = useState<string | null>(null)

  const colorChoiceButtonClass = (selected: boolean) =>
    [
      'counter relative flex min-w-[7.5rem] flex-1 items-center justify-between gap-2 !py-2.5 !pl-3 !pr-2 transition-[box-shadow,background-color,border-color]',
      selected
        ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-[var(--accent-border)] ring-offset-2 ring-offset-[var(--social-bg)]'
        : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text-h)] hover:bg-[var(--code-bg)]',
    ].join(' ')

  return (
    <ModalFrame
      title={t({ en: 'Create repertoire', fr: 'Créer un répertoire' })}
      onClose={() => {
        if (!busy) onClose()
      }}
      actions={
        <>
          <button type="button" className="counter" disabled={busy} onClick={onClose}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
          <button
            type="button"
            className="counter"
            disabled={busy || !title.trim()}
            onClick={() => {
              if (side == null) {
                setSideError(
                  t({
                    en: 'Choose White or Black for this repertoire.',
                    fr: 'Choisis les Blancs ou les Noirs pour ce répertoire.',
                  }),
                )
                return
              }
              void (async () => {
                const ok = await onSubmit(title.trim(), side, description.trim() || undefined)
                if (ok) onClose()
              })()
            }}
          >
            {t({ en: 'Create', fr: 'Créer' })}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-left text-sm text-[var(--text-h)]">
        <div>
          <label className="block text-xs font-medium opacity-90" htmlFor="create-rep-title">
            {t({ en: 'Title', fr: 'Titre' })}
          </label>
          <input
            id="create-rep-title"
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t({ en: 'My opening…', fr: 'Mon ouverture…' })}
            maxLength={80}
            disabled={busy}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium opacity-90" htmlFor="create-rep-description">
            {t({ en: 'Short description', fr: 'Description courte' })}
          </label>
          <input
            id="create-rep-description"
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm italic"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t({
              en: 'e.g. Practical anti-Sicilian lines',
              fr: 'ex : Lignes pratiques anti-Sicilienne',
            })}
            maxLength={140}
            disabled={busy}
          />
        </div>
        <div>
          <span className="block text-xs font-medium opacity-90">
            {t({ en: 'Repertoire color', fr: 'Couleur du répertoire' })}
          </span>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={colorChoiceButtonClass(side === 'white')}
              disabled={busy}
              aria-pressed={side === 'white'}
              onClick={() => {
                setSide('white')
                setSideError(null)
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full border border-neutral-400 bg-white shadow-sm" aria-hidden />
                {t({ en: 'White', fr: 'Blancs' })}
              </span>
              {side === 'white' ? (
                <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
            </button>
            <button
              type="button"
              className={colorChoiceButtonClass(side === 'black')}
              disabled={busy}
              aria-pressed={side === 'black'}
              onClick={() => {
                setSide('black')
                setSideError(null)
              }}
            >
              <span className="inline-flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full border border-neutral-800 bg-neutral-900 dark:border-neutral-600 dark:bg-neutral-950"
                  aria-hidden
                />
                {t({ en: 'Black', fr: 'Noirs' })}
              </span>
              {side === 'black' ? (
                <Check className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden />
              ) : (
                <span className="h-4 w-4 shrink-0" />
              )}
            </button>
          </div>
          {sideError ? <p className="mt-2 text-xs font-medium text-red-600 dark:text-red-400">{sideError}</p> : null}
        </div>
      </div>
    </ModalFrame>
  )
}

export function CreateRepertoireModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (title: string, side: Side, description?: string) => Promise<boolean>
}) {
  if (!open) return null
  return <CreateRepertoireModalInner busy={busy} onClose={onClose} onSubmit={onSubmit} />
}

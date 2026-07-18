import type { ReactNode } from 'react'

import { useI18n } from '../../../i18n'

export function ModalFrame({
  title,
  children,
  actions,
  onClose,
}: {
  title: string
  children: ReactNode
  actions: ReactNode
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 md:bottom-0 md:left-[208px] md:right-0 md:top-[74px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[520px] rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-[var(--shadow)]">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium text-[var(--text-h)]">{title}</div>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm hover:bg-[var(--accent-bg)]"
            onClick={onClose}
            aria-label={t({ en: 'Close', fr: 'Fermer' })}
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
        <div className="mt-4 flex justify-end gap-4">{actions}</div>
      </div>
    </div>
  )
}

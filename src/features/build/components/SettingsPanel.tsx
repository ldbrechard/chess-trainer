import { useI18n } from '../../../i18n'
import type { AnimationSpeed } from '../buildTypes'
import { ModalFrame } from './ModalFrame'
import { ToggleRow } from './ToggleRow'

export type SettingsPanelBodyProps = {
  fen: string
  flipBoard: boolean
  showDests: boolean
  showBoardAnnotations: boolean
  showAnnotationsToggle: boolean
  animationSpeed: AnimationSpeed
  replayMoves: boolean
  soundOn: boolean
  notificationsEnabled: boolean
  notificationsSupported: boolean
  onCopyFen: () => void
  onToggleFlip: () => void
  onToggleDests: () => void
  onToggleAnnotations: () => void
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void
  onToggleReplayMoves: () => void
  onToggleSound: () => void
  onToggleNotifications: () => void
}

export function SettingsPanelBody({
  fen,
  flipBoard,
  showDests,
  showBoardAnnotations,
  showAnnotationsToggle,
  animationSpeed,
  replayMoves,
  soundOn,
  notificationsEnabled,
  notificationsSupported,
  onCopyFen,
  onToggleFlip,
  onToggleDests,
  onToggleAnnotations,
  onChangeAnimationSpeed,
  onToggleReplayMoves,
  onToggleSound,
  onToggleNotifications,
}: SettingsPanelBodyProps) {
  const { t } = useI18n()
  return (
    <div className="space-y-4 text-left text-sm">
      <ToggleRow label={t({ en: 'Flip board', fr: "Inverser l'échiquier" })} checked={flipBoard} onChange={onToggleFlip} />
      <ToggleRow
        label={t({ en: 'Show destination squares', fr: 'Afficher les cases de destination' })}
        checked={showDests}
        onChange={onToggleDests}
      />
      <div className="space-y-2">
        <div className="text-[var(--text-h)]">{t({ en: 'Animation speed', fr: "Vitesse d'animation" })}</div>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['very_fast', t({ en: 'Very fast', fr: 'Très rapide' })],
              ['fast', t({ en: 'Fast', fr: 'Rapide' })],
              ['medium', t({ en: 'Medium', fr: 'Moyenne' })],
              ['slow', t({ en: 'Slow', fr: 'Lente' })],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={[
                'rounded border px-2 py-1 text-xs transition-colors',
                animationSpeed === id
                  ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]'
                  : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--code-bg)]',
              ].join(' ')}
              onClick={() => onChangeAnimationSpeed(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ToggleRow label={t({ en: 'Replay moves', fr: 'Rejouer les coups' })} checked={replayMoves} onChange={onToggleReplayMoves} />
      <ToggleRow label={t({ en: 'Sound on / off', fr: 'Son on / off' })} checked={soundOn} onChange={onToggleSound} />
      <ToggleRow
        label={t({ en: 'Daily reminders (FSRS + 48h)', fr: 'Rappels quotidiens (FSRS + 48h)' })}
        checked={notificationsEnabled}
        onChange={onToggleNotifications}
        disabled={!notificationsSupported}
      />
      {!notificationsSupported ? (
        <div className="text-xs opacity-75">
          {t({
            en: 'Notifications are not supported on this device/browser.',
            fr: 'Les notifications ne sont pas supportées sur cet appareil/navigateur.',
          })}
        </div>
      ) : null}
      {showAnnotationsToggle ? (
        <ToggleRow
          label={t({ en: 'Show annotations', fr: 'Afficher annotations' })}
          checked={showBoardAnnotations}
          onChange={onToggleAnnotations}
        />
      ) : null}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="text-[var(--text-h)]">FEN</span>
          <button type="button" className="counter text-xs" onClick={onCopyFen}>
            {t({ en: 'Copy FEN', fr: 'Copier FEN' })}
          </button>
        </div>
        <div className="break-all rounded-md bg-[var(--code-bg)] px-3 py-2 font-mono text-sm text-[var(--text-h)]">
          {fen}
        </div>
      </div>
    </div>
  )
}

export function SettingsPopup({ onClose, ...panelProps }: SettingsPanelBodyProps & { onClose: () => void }) {
  const { t } = useI18n()
  return (
    <ModalFrame
      title={t({ en: 'Settings', fr: 'Paramètres' })}
      onClose={onClose}
      actions={
        <button type="button" className="counter" onClick={onClose}>
          OK
        </button>
      }
    >
      <SettingsPanelBody {...panelProps} />
    </ModalFrame>
  )
}

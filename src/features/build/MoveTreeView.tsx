import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import type { Move } from '../../db/schema'
import type { MoveForest, MoveNode } from '../../chess/moveTree'
import { useI18n } from '../../i18n'

type Props = {
  forest: MoveForest
  pathIds: Set<string>
  onSelectMove: (move: Move) => void | Promise<void>
  onDeleteMove?: (move: Move) => void | Promise<void>
}

export function MoveTreeView({ forest, pathIds, onSelectMove, onDeleteMove }: Props) {
  const { t } = useI18n()
  const [expandedVarKeys, setExpandedVarKeys] = useState<Set<string>>(() => new Set())
  const [expandedContinuationIds, setExpandedContinuationIds] = useState<Set<string>>(() => new Set())

  const ctx = useMemo(
    () => ({
      expandedVarKeys,
      setExpandedVarKeys,
      expandedContinuationIds,
      setExpandedContinuationIds,
    }),
    [expandedContinuationIds, expandedVarKeys],
  )

  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
      <div className="mt-1 text-sm leading-5">
        {renderForest(forest, pathIds, onSelectMove, onDeleteMove, 0, 'root', true, ctx, t)}
      </div>
    </div>
  )
}

type Ctx = {
  expandedVarKeys: Set<string>
  setExpandedVarKeys: Dispatch<SetStateAction<Set<string>>>
  expandedContinuationIds: Set<string>
  setExpandedContinuationIds: Dispatch<SetStateAction<Set<string>>>
}

function normalizeNagToken(t: string): string {
  const s = t.trim()
  if (!s) return ''
  if (s.startsWith('$')) {
    const n = Number(s.slice(1))
    if (!Number.isFinite(n)) return s
    // Common PGN NAGs
    switch (n) {
      case 1:
        return '!'
      case 2:
        return '?'
      case 3:
        return '!!'
      case 4:
        return '??'
      case 5:
        return '!?'
      case 6:
        return '?!'
      case 10:
        return '='
      case 13:
        return '∞'
      case 14:
        return '+='
      case 15:
        return '=+'
      case 16:
        return '+-'
      case 17:
        return '-+'
      default:
        return s
    }
  }
  return s
}

export function formatMoveWithNag(move: Move): string {
  const raw = move.nag?.trim() ?? ''
  if (!raw) return move.notation

  // Allow either a single token ("!?") or space-separated tokens ("$1 $14").
  const tokens = raw.split(/\s+/).map(normalizeNagToken).filter(Boolean)
  if (tokens.length === 0) return move.notation

  const glued = tokens.join('')
  // Standard “quality” glyphs stick to the move; other annotations keep a space.
  const stickToMove = /^(?:!|\?|!!|\?\?|!\?|\?!)+$/.test(glued)
  return stickToMove ? `${move.notation}${glued}` : `${move.notation} ${glued}`
}

function renderForest(
  forest: MoveForest,
  pathIds: Set<string>,
  onSelectMove: Props['onSelectMove'],
  onDeleteMove: Props['onDeleteMove'],
  depth: number,
  forestKey: string,
  atLineStart: boolean,
  ctx: Ctx,
  t: ReturnType<typeof useI18n>['t'],
) {
  if (forest.length === 0) {
    return <span className="opacity-80">{t({ en: '(empty)', fr: '(vide)' })}</span>
  }

  // Lichess-like: pick first as mainline, render siblings as variations.
  const [main, ...vars] = forest
  const variationsKey = `vars:${forestKey}:${depth}`
  const varsExpanded = ctx.expandedVarKeys.has(variationsKey)
  const showVarsToggle = vars.length > 0

  return (
    <>
      {main ? renderLine(main, pathIds, onSelectMove, onDeleteMove, depth, atLineStart, ctx, t) : null}

      {showVarsToggle ? (
        <div className="mt-1">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-[var(--text-h)] hover:bg-[var(--accent-bg)]"
            onClick={() => {
              ctx.setExpandedVarKeys((prev) => {
                const next = new Set(prev)
                if (next.has(variationsKey)) next.delete(variationsKey)
                else next.add(variationsKey)
                return next
              })
            }}
          >
            <span className="font-mono">{varsExpanded ? '▾' : '▸'}</span>
                <span className="opacity-80">
                  {vars[0]?.move.notation
                    ? `${moveNumberPrefix(depth, true)}${formatMoveWithNag(vars[0].move)}`
                    : ''}
                </span>
          </button>

          {varsExpanded ? (
            <div className="mt-1 space-y-1 border-l border-[var(--border)] pl-2">
              {vars.map((v) => (
                <div key={v.move.id} className="opacity-95">
                  {renderLine(v, pathIds, onSelectMove, onDeleteMove, depth, true, ctx, t)}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

export function moveNumberPrefix(depth: number, atLineStart: boolean): string {
  const moveNo = Math.floor(depth / 2) + 1
  const isWhitePly = depth % 2 === 0
  if (isWhitePly) return `${moveNo}. `
  if (atLineStart) return `${moveNo}... `
  return ''
}

function renderLine(
  node: MoveNode,
  pathIds: Set<string>,
  onSelectMove: Props['onSelectMove'],
  onDeleteMove: Props['onDeleteMove'],
  depth: number,
  atLineStart: boolean,
  ctx: Ctx,
  t: ReturnType<typeof useI18n>['t'],
): ReactNode {
  const id = node.move.id
  const isInPath = id != null && pathIds.has(id)
  const prefix = moveNumberPrefix(depth, atLineStart)

  const moveEl = (
    <button
      type="button"
      className={[
        'rounded px-1 font-mono hover:bg-[var(--accent-bg)]',
        isInPath ? 'bg-[var(--accent-bg)] text-[var(--text-h)]' : 'text-[var(--text-h)]',
      ].join(' ')}
      onContextMenu={
        onDeleteMove && node.move.id != null
          ? (e) => {
              e.preventDefault()
              void onDeleteMove(node.move)
            }
          : undefined
      }
      onClick={() => void onSelectMove(node.move)}
    >
      <span>
        {prefix}
        {formatMoveWithNag(node.move)}
      </span>
    </button>
  )

  if (node.children.length === 0) return moveEl

  const CONTINUATION_LIMIT = 14
  const canCollapseContinuation = id != null && depth >= CONTINUATION_LIMIT
  const continuationExpanded = id != null && ctx.expandedContinuationIds.has(id)

  return (
    <>
      {moveEl}{' '}
      {canCollapseContinuation && !continuationExpanded ? (
        <button
          type="button"
          className="rounded px-1 py-0.5 text-xs text-[var(--text-h)] hover:bg-[var(--accent-bg)]"
          onClick={() => {
            if (id == null) return
            ctx.setExpandedContinuationIds((prev) => new Set(prev).add(id))
          }}
        >
          …
        </button>
      ) : (
        renderForest(
          node.children,
          pathIds,
          onSelectMove,
          onDeleteMove,
          depth + 1,
          String(id ?? 'x'),
          false,
          ctx,
          t,
        )
      )}
    </>
  )
}


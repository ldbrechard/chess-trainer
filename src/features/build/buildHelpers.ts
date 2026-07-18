import { Chess } from 'chess.js'
import { pickMainLineChild } from '../../chess/moveTree'
import type { Move, Side } from '../../db/schema'

export function sideToTurn(side: Side): 'w' | 'b' {
  return side === 'white' ? 'w' : 'b'
}

export function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function formatDurationMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

/** Chessground must revert the drag if the move is not applied (see Board `after`). */
export function rejectBoardMove(): never {
  const e = new Error('BOARD_MOVE_REJECTED')
  e.name = 'BoardMoveRejected'
  throw e
}

export function isBoardMoveRejected(e: unknown): boolean {
  return e instanceof Error && e.name === 'BoardMoveRejected'
}

/** Coups attendus pour la couleur répertoire à ce nœud (toutes les réponses ou ligne principale seule). */
export function expectedTrainReplies(children: Move[], mainLineOnly: boolean): Move[] {
  if (children.length === 0) return []
  if (mainLineOnly) {
    const main = pickMainLineChild(children)
    return main ? [main] : []
  }
  return children
}

export function computeTrainPositionsForRepertoire(side: Side, moves: Move[]): Array<string | null> {
  const byId = new Map<string, Move>()
  for (const m of moves) byId.set(m.id, m)

  const childrenByParent = new Map<string | null, Move[]>()
  for (const m of moves) {
    const key = m.parentId ?? null
    const list = childrenByParent.get(key)
    if (list) list.push(m)
    else childrenByParent.set(key, [m])
  }

  const out: Array<string | null> = []
  for (const parentId of childrenByParent.keys()) {
    const kids = childrenByParent.get(parentId) ?? []
    if (kids.length === 0) continue
    const fen = parentId == null ? new Chess().fen() : byId.get(parentId)?.fen
    if (!fen) continue
    const c = new Chess()
    try {
      c.load(fen)
    } catch {
      continue
    }
    if (c.turn() === sideToTurn(side)) out.push(parentId)
  }
  return out
}

export function computeMaxDepthForRepertoire(moves: Move[]): number {
  if (moves.length === 0) return 0
  const byId = new Map<string, Move>()
  for (const move of moves) byId.set(move.id, move)
  const depthById = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depthById.get(id)
    if (cached != null) return cached
    const move = byId.get(id)
    if (!move) return 0
    const depth = move.parentId ? depthOf(move.parentId) + 1 : 1
    depthById.set(id, depth)
    return depth
  }
  let maxDepth = 0
  for (const move of moves) {
    const d = depthOf(move.id)
    if (d > maxDepth) maxDepth = d
  }
  return maxDepth
}

export function computeMainLineTerminalFen(moves: Move[]): string {
  if (moves.length === 0) return new Chess().fen()
  const childrenByParent = new Map<string | null, Move[]>()
  for (const m of moves) {
    const key = m.parentId ?? null
    const list = childrenByParent.get(key)
    if (list) list.push(m)
    else childrenByParent.set(key, [m])
  }
  let parentId: string | null = null
  let currentFen = new Chess().fen()
  for (;;) {
    const children = childrenByParent.get(parentId) ?? []
    if (children.length === 0) return currentFen
    const main = pickMainLineChild(children)
    if (!main) return currentFen
    currentFen = main.fen
    parentId = main.id
  }
}

/** Most recent `lastTrainDayKey` first; repertoires without a train date sort last. */
export function compareRepertoiresByLastTrainDesc(
  a: { lastTrainDayKey?: string },
  b: { lastTrainDayKey?: string },
): number {
  const ak = a.lastTrainDayKey ?? ''
  const bk = b.lastTrainDayKey ?? ''
  if (!ak && !bk) return 0
  if (!ak) return 1
  if (!bk) return -1
  return bk.localeCompare(ak)
}

export function pvUciToSanLine(fen: string, pvUci: string[] | undefined): string {
  if (!pvUci || pvUci.length === 0) return '—'
  const c = new Chess()
  try {
    c.load(fen)
  } catch {
    return pvUci.join(' ')
  }
  const out: string[] = []
  for (let i = 0; i < pvUci.length; i += 1) {
    const uci = pvUci[i]!
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    const m = c.move({ from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined })
    if (!m) break
    if (m.color === 'w') out.push(`${Math.max(1, c.moveNumber() - 1)}. ${m.san}`)
    else out.push(m.san)
  }
  return out.length > 0 ? out.join(' ') : pvUci.join(' ')
}

export function lineToPgnMoves(moves: Move[]): string {
  if (moves.length === 0) return '*'
  const tokens: string[] = []
  for (let ply = 0; ply < moves.length; ply += 1) {
    const m = moves[ply]!
    if (ply % 2 === 0) tokens.push(`${Math.floor(ply / 2) + 1}.`)
    tokens.push(m.notation)
  }
  tokens.push('*')
  return tokens.join(' ')
}

export function formatLastTrainLabel(
  dayKey: string | undefined,
  t: (msg: { en: string; fr: string }, vars?: Record<string, string | number>) => string,
): string {
  if (!dayKey) return t({ en: 'Never', fr: 'Jamais' })
  const [y, m, d] = dayKey.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayKey
  const trainMs = new Date(y, m - 1, d, 12, 0, 0, 0).getTime()
  const daysAgo = Math.max(0, Math.floor((Date.now() - trainMs) / 86400000))
  if (daysAgo === 0) return t({ en: 'Today', fr: "Aujourd'hui" })
  if (daysAgo === 1) return t({ en: 'Yesterday', fr: 'Hier' })
  return t({ en: '{count} days ago', fr: 'Il y a {count} jours' }, { count: daysAgo })
}

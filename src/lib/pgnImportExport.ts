import { parseGames } from '@mliebelt/pgn-parser'
import type { PgnMove } from '@mliebelt/pgn-types'
import { Chess } from 'chess.js'
import { compareSiblings } from '../chess/moveTree'
import type { Move, Repertoire } from '../db/schema'

export type ImportMoveRow = {
  id: string
  parentId: string | null
  fen: string
  notation: string
  nag?: string
  comment: string
}

export type PgnImportPreview = {
  chapters: number
  moves: number
  variants: number
  suggestedTitle: string
  rows: ImportMoveRow[]
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, '')
}

/** Raw movetext without headers → minimal seven-tag wrapper */
export function ensurePgnWithHeaders(pgn: string): string {
  const t = stripBom(pgn).trim()
  if (t.startsWith('[')) return t
  return (
    `[Event "Import"]\n` +
    `[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n` +
    t
  )
}

function nagTokensToField(nags: string[] | undefined): string | undefined {
  if (!nags?.length) return undefined
  const parts = nags.map((n) => n.trim()).filter(Boolean)
  if (!parts.length) return undefined
  return parts.join(' ').slice(0, 32)
}

function sanFromPgnMove(m: PgnMove): string {
  return m.notation.notation.trim()
}

function walkMoves(chess: Chess, moves: PgnMove[], parentId: string | null, out: ImportMoveRow[]): void {
  let pid = parentId
  for (const m of moves) {
    const fenAtFork = chess.fen()
    const san = sanFromPgnMove(m)

    for (const varLine of m.variations ?? []) {
      if (!varLine?.length) continue
      const branch = new Chess(fenAtFork)
      walkMoves(branch, varLine, pid, out)
    }

    const next = new Chess(chess.fen())
    const played = next.move(san)
    if (!played) {
      throw new Error(`Coup illégal ou ambigu : « ${san} »`)
    }
    const id = crypto.randomUUID()
    out.push({
      id,
      parentId: pid,
      fen: next.fen(),
      notation: played.san,
      nag: nagTokensToField(m.nag),
      comment: [m.commentMove, m.commentAfter].filter(Boolean).join('\n').trim(),
    })
    chess.move(san)
    pid = id
  }
}

function countLeaves(rows: ImportMoveRow[]): number {
  const hasChild = new Set<string>()
  for (const r of rows) {
    if (r.parentId) hasChild.add(r.parentId)
  }
  return rows.filter((r) => !hasChild.has(r.id)).length
}

type ParsedGame = ReturnType<typeof parseGames>[number]

function suggestedTitleFromGames(games: ParsedGame[]): string {
  const ev = games[0]?.tags?.Event
  if (typeof ev === 'string' && ev.trim()) return ev.trim().slice(0, 80)
  const opening = games[0]?.tags?.Opening
  if (typeof opening === 'string' && opening.trim()) return opening.trim().slice(0, 80)
  return 'Répertoire importé'
}

function startingChessForGame(game: ParsedGame): Chess {
  const fenTag = game.tags?.FEN
  const fen = typeof fenTag === 'string' && fenTag.trim() ? fenTag.trim() : undefined
  const c = new Chess()
  if (fen) {
    c.load(fen)
  }
  return c
}

export function tryBuildImportPreview(pgnText: string): { ok: true; preview: PgnImportPreview } | { ok: false; error: string } {
  let games: ParsedGame[]
  try {
    games = parseGames(ensurePgnWithHeaders(pgnText))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `PGN invalide : ${msg}` }
  }
  if (!games.length) return { ok: false, error: 'Aucune partie trouvée dans le fichier.' }

  const rows: ImportMoveRow[] = []
  try {
    for (const game of games) {
      const chess = startingChessForGame(game)
      walkMoves(chess, game.moves ?? [], null, rows)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: msg }
  }

  if (rows.length === 0) return { ok: false, error: 'Aucun coup jouable trouvé dans le PGN.' }

  return {
    ok: true,
    preview: {
      chapters: games.length,
      moves: rows.length,
      variants: countLeaves(rows),
      suggestedTitle: suggestedTitleFromGames(games),
      rows,
    },
  }
}

function escapeHeader(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function fullmoveFromFen(fen: string): number {
  const p = fen.split(/\s+/)
  return Math.max(1, parseInt(p[5] ?? '1', 10) || 1)
}

function moveTokenBefore(chess: Chess, moveResult: { san: string }): string {
  const turn = chess.turn()
  const fm = fullmoveFromFen(chess.fen())
  const num = turn === 'w' ? `${fm}.` : `${fm}...`
  return `${num} ${moveResult.san}`
}

function formatMoveSuffix(m: Move): string {
  let s = ''
  if (m.nag?.trim()) s += m.nag.trim().startsWith('$') || /^[!?]+$/.test(m.nag.trim()) ? m.nag.trim() : ` ${m.nag.trim()}`
  if (m.comment?.trim()) s += ` {${m.comment.replace(/[{}]/g, '').trim()}}`
  return s
}

/** Recursive PGN fragment from `parentId` with board `chess` already at that node's position. */
function renderFrom(
  parentId: string | null,
  chess: Chess,
  byParent: Map<string | null, Move[]>,
): string {
  const kids = (byParent.get(parentId) ?? []).slice().sort(compareSiblings)
  if (!kids.length) return ''

  const main = kids[0]!
  const fenBefore = chess.fen()
  const mr = chess.move(main.notation)
  if (!mr) return ''

  let out = moveTokenBefore(new Chess(fenBefore), mr) + formatMoveSuffix(main)

  for (let i = 1; i < kids.length; i++) {
    const alt = kids[i]!
    const c = new Chess(fenBefore)
    const ar = c.move(alt.notation)
    if (!ar) continue
    const head = moveTokenBefore(new Chess(fenBefore), ar) + formatMoveSuffix(alt)
    const tail = renderFrom(alt.id, c, byParent)
    out += ` (${head}${tail ? ` ${tail}` : ''})`
  }

  const tailMain = renderFrom(main.id, chess, byParent)
  if (tailMain) out += ` ${tailMain}`
  return out
}

export function exportRepertoireToPgn(rep: Repertoire, moves: Move[]): string {
  const byParent = new Map<string | null, Move[]>()
  for (const m of moves) {
    const k = m.parentId
    const arr = byParent.get(k) ?? []
    arr.push(m)
    byParent.set(k, arr)
  }

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.')
  const orient = rep.side === 'black' ? 'Black' : 'White'
  const movetext = renderFrom(null, new Chess(), byParent)

  return (
    `[Event "${escapeHeader(rep.title)}"]\n` +
    `[Site "ChessTrainer"]\n` +
    `[Date "${today}"]\n` +
    `[Round "?"]\n` +
    `[White "?"]\n` +
    `[Black "?"]\n` +
    `[Result "*"]\n` +
    `[Orientation "${orient}"]\n` +
    `\n` +
    `${movetext} *\n`
  )
}

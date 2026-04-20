import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

export type PuzzleDifficulty = 'easy' | 'medium' | 'hard'
export type PuzzleScope = 'repertoire' | 'current'

export type PuzzleRow = {
  PuzzleId: string
  FEN: string
  Moves: string
  Rating: number
  Themes?: string | null
  OpeningTags?: string | null
  GameUrl?: string | null
}

export type PuzzlePrepared = {
  id: string
  initialFen: string
  presentedFen: string
  solutionUci: string[]
  rating: number
  themes: string
  openingTags: string
  gameUrl: string | null
  playerTurn: 'w' | 'b'
}

export function ratingRangeForDifficulty(difficulty: PuzzleDifficulty): { min: number; max: number } {
  switch (difficulty) {
    case 'easy':
      return { min: 600, max: 1500 }
    case 'hard':
      return { min: 2200, max: 3200 }
    case 'medium':
    default:
      return { min: 1500, max: 2200 }
  }
}

export function openingNameToTagCandidates(name: string): string[] {
  const clean = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!clean) return []
  const words = clean.split('_').filter(Boolean)
  if (words.length === 0) return []

  const out = new Set<string>()
  if (words.length >= 2) {
    for (let i = 2; i <= words.length; i += 1) {
      out.add(words.slice(0, i).join('_'))
    }
  } else {
    out.add(clean)
  }
  out.add(clean)
  return [...out]
}

export function openingNameToCanonicalTag(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

export function titleToTagCandidates(title: string | undefined): string[] {
  if (!title) return []
  return openingNameToTagCandidates(title)
}

export function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function parsePuzzleMoves(rawMoves: string): string[] {
  return rawMoves
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4)
}

export function playUci(chess: Chess, uci: string) {
  const t = uci.trim()
  if (t.length < 4) return null
  const from = t.slice(0, 2)
  const to = t.slice(2, 4)
  const promotion = t.length >= 5 ? (t[4] as 'q' | 'r' | 'b' | 'n') : undefined
  return chess.move({ from, to, promotion })
}

export function preparePuzzle(row: PuzzleRow): PuzzlePrepared | null {
  const moves = parsePuzzleMoves(row.Moves)
  if (moves.length < 2) return null

  const c = new Chess()
  try {
    c.load(row.FEN)
  } catch {
    return null
  }

  const first = playUci(c, moves[0]!)
  if (!first) return null

  const presentedFen = c.fen()
  const solutionUci = moves.slice(1)
  if (solutionUci.length === 0) return null

  return {
    id: row.PuzzleId,
    initialFen: row.FEN,
    presentedFen,
    solutionUci,
    rating: Number(row.Rating) || 0,
    themes: row.Themes ?? '',
    openingTags: row.OpeningTags ?? '',
    gameUrl: row.GameUrl ?? null,
    playerTurn: c.turn(),
  }
}

export function uciFromBoardMove(from: Key, to: Key, promotion?: string): string {
  const promo = promotion?.trim().toLowerCase()
  if (promo && ['q', 'r', 'b', 'n'].includes(promo)) return `${from}${to}${promo}`
  return `${from}${to}`
}

export function areUciMovesEquivalent(expected: string, attempted: string): boolean {
  const a = expected.trim().toLowerCase()
  const b = attempted.trim().toLowerCase()
  if (a === b) return true
  // If expected has promotion and attempted does not, treat as mismatch.
  if (a.length >= 5 || b.length >= 5) return false
  return a.slice(0, 4) === b.slice(0, 4)
}

export function uciToMoveKeys(uci: string): { from: Key; to: Key } | null {
  const t = uci.trim().toLowerCase()
  if (t.length < 4) return null
  const from = t.slice(0, 2) as Key
  const to = t.slice(2, 4) as Key
  return { from, to }
}


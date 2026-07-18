import { describe, expect, it } from 'vitest'

import type { Move, Repertoire } from '../db/schema'
import { ensurePgnWithHeaders, exportRepertoireToPgn, tryBuildImportPreview } from './pgnImportExport'

describe('ensurePgnWithHeaders', () => {
  it('wraps bare movetext', () => {
    const out = ensurePgnWithHeaders('1. e4 e5 *')
    expect(out.startsWith('[Event')).toBe(true)
    expect(out).toContain('1. e4 e5 *')
  })

  it('keeps tagged PGN as-is (trimmed)', () => {
    const tagged = '[Event "X"]\n\n1. e4 *'
    expect(ensurePgnWithHeaders(`  ${tagged}  `)).toBe(tagged)
  })
})

describe('tryBuildImportPreview', () => {
  it('imports a short main line with a variation', () => {
    const pgn = `
[Event "Test Opening"]
[Result "*"]

1. e4 e5 (1... c5) 2. Nf3 *
`
    const result = tryBuildImportPreview(pgn)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.preview.suggestedTitle).toBe('Test Opening')
    expect(result.preview.moves).toBeGreaterThanOrEqual(3)
    expect(result.preview.variants).toBeGreaterThanOrEqual(2)
    expect(result.preview.rows.some((r) => r.notation === 'e4')).toBe(true)
  })

  it('rejects illegal moves', () => {
    const result = tryBuildImportPreview('1. e4 e5 2. e5 *')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.toLowerCase()).toMatch(/illégal|illegal|invalid|ambigu/)
  })
})

describe('exportRepertoireToPgn', () => {
  it('exports siblings as PGN variations', () => {
    const rep: Repertoire = {
      id: 'r1',
      title: 'Italian',
      side: 'white',
      createdAt: 1,
    }
    const moves: Move[] = [
      {
        id: 'm1',
        repertoireId: 'r1',
        parentId: null,
        fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
        notation: 'e4',
        comment: '',
        isMainLine: true,
        createdAt: '2020-01-01T00:00:00.000Z',
      },
      {
        id: 'm2',
        repertoireId: 'r1',
        parentId: 'm1',
        fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
        notation: 'e5',
        comment: '',
        createdAt: '2020-01-01T00:00:01.000Z',
      },
      {
        id: 'm3',
        repertoireId: 'r1',
        parentId: 'm1',
        fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
        notation: 'c5',
        comment: '',
        createdAt: '2020-01-01T00:00:02.000Z',
      },
    ]
    const pgn = exportRepertoireToPgn(rep, moves)
    expect(pgn).toContain('[Event "Italian"]')
    expect(pgn).toContain('[Orientation "White"]')
    expect(pgn).toContain('e4')
    expect(pgn).toContain('(')
    expect(pgn).toContain('c5')
  })
})

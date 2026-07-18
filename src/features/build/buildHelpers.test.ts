import { Chess } from 'chess.js'
import { describe, expect, it } from 'vitest'

import type { Move } from '../../db/schema'
import {
  compareRepertoiresByLastTrainDesc,
  computeMainLineTerminalFen,
  computeMaxDepthForRepertoire,
  computeTrainPositionsForRepertoire,
  expectedTrainReplies,
  formatDurationMs,
  lineToPgnMoves,
  pvUciToSanLine,
} from './buildHelpers'

function move(partial: Partial<Move> & Pick<Move, 'id' | 'notation' | 'fen'>): Move {
  return {
    repertoireId: 'r1',
    parentId: null,
    comment: '',
    createdAt: '2020-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('computeTrainPositionsForRepertoire', () => {
  it('includes root when it is White to move for a white repertoire', () => {
    const e4Fen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    const positions = computeTrainPositionsForRepertoire('white', [
      move({ id: 'e4', notation: 'e4', fen: e4Fen, parentId: null }),
    ])
    expect(positions).toContain(null)
  })

  it('includes black reply nodes for a black repertoire', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2'
    const positions = computeTrainPositionsForRepertoire('black', [
      move({ id: 'e4', notation: 'e4', fen: afterE4, parentId: null }),
      move({ id: 'e5', notation: 'e5', fen: afterE5, parentId: 'e4' }),
    ])
    expect(positions).toContain('e4')
  })
})

describe('depth / main line / replies', () => {
  it('computes max depth along ancestry', () => {
    const moves = [
      move({ id: 'a', notation: 'e4', fen: 'f1', parentId: null }),
      move({ id: 'b', notation: 'e5', fen: 'f2', parentId: 'a' }),
      move({ id: 'c', notation: 'Nf3', fen: 'f3', parentId: 'b' }),
    ]
    expect(computeMaxDepthForRepertoire(moves)).toBe(3)
  })

  it('follows main-line flags for terminal fen', () => {
    const start = new Chess().fen()
    const e4 = move({
      id: 'e4',
      notation: 'e4',
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      parentId: null,
      isMainLine: true,
    })
    const d4 = move({
      id: 'd4',
      notation: 'd4',
      fen: 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3 0 1',
      parentId: null,
    })
    expect(computeMainLineTerminalFen([d4, e4])).toBe(e4.fen)
    expect(computeMainLineTerminalFen([])).toBe(start)
  })

  it('filters expected replies when mainLineOnly', () => {
    const kids = [
      move({ id: 'a', notation: 'e5', fen: 'x', isMainLine: false }),
      move({ id: 'b', notation: 'c5', fen: 'y', isMainLine: true }),
    ]
    expect(expectedTrainReplies(kids, true).map((m) => m.id)).toEqual(['b'])
    expect(expectedTrainReplies(kids, false)).toHaveLength(2)
  })
})

describe('formatting helpers', () => {
  it('formats durations as m:ss', () => {
    expect(formatDurationMs(0)).toBe('0:00')
    expect(formatDurationMs(65_000)).toBe('1:05')
  })

  it('formats a line as PGN tokens', () => {
    expect(
      lineToPgnMoves([
        move({ id: '1', notation: 'e4', fen: 'a' }),
        move({ id: '2', notation: 'e5', fen: 'b' }),
      ]),
    ).toBe('1. e4 e5 *')
  })

  it('sorts repertoires by last train day desc', () => {
    const sorted = [
      { lastTrainDayKey: '2024-01-01' },
      { lastTrainDayKey: undefined },
      { lastTrainDayKey: '2024-02-01' },
    ].sort(compareRepertoiresByLastTrainDesc)
    expect(sorted.map((r) => r.lastTrainDayKey)).toEqual(['2024-02-01', '2024-01-01', undefined])
  })

  it('does not throw when replaying a stale PV on a new FEN (chess.js throws on illegal moves)', () => {
    const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1'
    // PV from the starting position, applied after 1.e4 → first ply already played / illegal.
    expect(() => pvUciToSanLine(afterE4, ['e2e4', 'e7e5', 'g1f3'])).not.toThrow()
    expect(pvUciToSanLine(afterE4, ['e2e4', 'e7e5', 'g1f3'])).toBe('e2e4 e7e5 g1f3')
  })
})

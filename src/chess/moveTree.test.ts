import { describe, expect, it } from 'vitest'

import type { Move } from '../db/schema'
import {
  buildMoveForest,
  collectLeafPaths,
  compareSiblings,
  pathToIdSet,
  pickMainLineChild,
} from './moveTree'

function move(partial: Partial<Move> & Pick<Move, 'id' | 'notation'>): Move {
  return {
    repertoireId: 'r1',
    parentId: null,
    fen: 'fen',
    comment: '',
    createdAt: '2020-01-01T00:00:00.000Z',
    ...partial,
  }
}

describe('compareSiblings', () => {
  it('puts main line before sidelines', () => {
    const a = move({ id: 'a', notation: 'e4', isMainLine: false, createdAt: '2020-01-01T00:00:00.000Z' })
    const b = move({ id: 'b', notation: 'd4', isMainLine: true, createdAt: '2020-01-02T00:00:00.000Z' })
    expect(compareSiblings(a, b)).toBeGreaterThan(0)
    expect(compareSiblings(b, a)).toBeLessThan(0)
  })
})

describe('pickMainLineChild', () => {
  it('returns the flagged main line when unique', () => {
    const kids = [
      move({ id: 'a', notation: 'e4', isMainLine: false }),
      move({ id: 'b', notation: 'd4', isMainLine: true }),
    ]
    expect(pickMainLineChild(kids)?.id).toBe('b')
  })

  it('falls back to sort order when no flag', () => {
    const kids = [
      move({ id: 'z', notation: 'c4', createdAt: '2020-01-02T00:00:00.000Z' }),
      move({ id: 'a', notation: 'e4', createdAt: '2020-01-01T00:00:00.000Z' }),
    ]
    expect(pickMainLineChild(kids)?.id).toBe('a')
  })
})

describe('buildMoveForest', () => {
  it('builds a sorted tree from flat moves', () => {
    const moves = [
      move({ id: 'e4', notation: 'e4', parentId: null, isMainLine: true }),
      move({ id: 'e5', notation: 'e5', parentId: 'e4' }),
      move({ id: 'c5', notation: 'c5', parentId: 'e4', createdAt: '2020-01-02T00:00:00.000Z' }),
      move({ id: 'd4', notation: 'd4', parentId: null, createdAt: '2020-01-03T00:00:00.000Z' }),
    ]
    const forest = buildMoveForest(moves)
    expect(forest.map((n) => n.move.id)).toEqual(['e4', 'd4'])
    expect(forest[0]!.children.map((n) => n.move.notation)).toEqual(['e5', 'c5'])
  })
})

describe('path helpers', () => {
  it('pathToIdSet collects ids', () => {
    const path = [move({ id: '1', notation: 'e4' }), move({ id: '2', notation: 'e5' })]
    expect([...pathToIdSet(path)]).toEqual(['1', '2'])
  })

  it('collectLeafPaths returns all terminal lines', () => {
    const forest = buildMoveForest([
      move({ id: 'e4', notation: 'e4', parentId: null }),
      move({ id: 'e5', notation: 'e5', parentId: 'e4' }),
      move({ id: 'c5', notation: 'c5', parentId: 'e4' }),
    ])
    const leaves = collectLeafPaths(forest)
    expect(leaves).toHaveLength(2)
    expect(leaves.map((p) => p.map((m) => m.notation).join(' ')).sort()).toEqual(['e4 c5', 'e4 e5'])
  })
})

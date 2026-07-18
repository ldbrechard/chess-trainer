import { describe, expect, it } from 'vitest'

import {
  remoteToStoredMove,
  remoteToStoredRep,
  shouldPullRemoteOverLocal,
  sortMovesForUpsert,
  ts,
} from './syncMappers'

describe('ts', () => {
  it('prefers updated_at over created_at', () => {
    expect(
      ts({
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-02T00:00:00.000Z',
      }),
    ).toBe(Date.parse('2020-01-02T00:00:00.000Z'))
  })
})

describe('remote mappers', () => {
  it('preserves local-only repertoire fields on pull', () => {
    const mapped = remoteToStoredRep(
      {
        id: 'r1',
        user_id: 'u1',
        title: 'Sicilian',
        side: 'black',
        created_at: '2020-01-01T00:00:00.000Z',
        updated_at: '2020-01-02T00:00:00.000Z',
      },
      {
        id: 'r1',
        title: 'old',
        side: 'black',
        createdAt: 1,
        updatedAt: 1,
        dirty: false,
        description: 'local note',
        trainStreak: 3,
        lastTrainDayKey: '2024-01-01',
        notificationsEnabled: true,
      },
    )
    expect(mapped.description).toBe('local note')
    expect(mapped.trainStreak).toBe(3)
    expect(mapped.dirty).toBe(false)
    expect(mapped.title).toBe('Sicilian')
  })

  it('maps move rows including main line flag', () => {
    const m = remoteToStoredMove({
      id: 'm1',
      repertoire_id: 'r1',
      parent_id: null,
      fen: 'fen',
      notation: 'e4',
      nag: '!',
      comment: null,
      eval: null,
      is_main_line: true,
      created_at: '2020-01-01T00:00:00.000Z',
    })
    expect(m.isMainLine).toBe(true)
    expect(m.comment).toBe('')
    expect(m.nag).toBe('!')
  })
})

describe('shouldPullRemoteOverLocal', () => {
  it('skips dirty locals and pulls when remote is newer', () => {
    expect(shouldPullRemoteOverLocal(undefined, 10)).toBe(true)
    expect(shouldPullRemoteOverLocal({ dirty: true, updatedAt: 1 }, 99)).toBe(false)
    expect(shouldPullRemoteOverLocal({ dirty: false, updatedAt: 5 }, 5)).toBe(true)
    expect(shouldPullRemoteOverLocal({ dirty: false, updatedAt: 10 }, 5)).toBe(false)
  })
})

describe('sortMovesForUpsert', () => {
  it('orders parents before children among dirty set', () => {
    const ordered = sortMovesForUpsert([
      { id: 'child', parentId: 'parent' },
      { id: 'parent', parentId: null },
      { id: 'grand', parentId: 'child' },
    ])
    expect(ordered.map((m) => m.id)).toEqual(['parent', 'child', 'grand'])
  })
})

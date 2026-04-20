import Dexie, { type Table } from 'dexie'

export type Side = 'white' | 'black'

export type RepertoireId = string
export type MoveId = string

export type Repertoire = {
  id: RepertoireId
  title: string
  side: Side
  createdAt: number
  /** Jours consécutifs avec au moins un entraînement terminé (local). */
  trainStreak?: number
}

/** Stockage FSRS par position (parentId = case où c’est à nous de jouer ; racine = `__root__`). */
export type StoredFsrsCard = {
  id: string
  repertoireId: RepertoireId
  parentPositionKey: string
  due: number
  stability: number
  difficulty: number
  scheduled_days: number
  elapsed_days: number
  reps: number
  lapses: number
  state: number
  learning_steps: number
  last_review?: number
}

export type Move = {
  id: MoveId
  repertoireId: RepertoireId
  parentId: MoveId | null
  fen: string
  notation: string
  /**
   * PGN NAG-like annotation (e.g. "!", "?!", "=").
   * Stored separately from SAN notation.
   */
  nag?: string
  comment: string
  eval?: number
  /** ISO timestamp; stable sibling ordering */
  createdAt?: string
  /** Among siblings: preferred branch for export / « train main line only ». At most one should be true per parent. */
  isMainLine?: boolean
}

/** Dexie row: local source of truth + sync flags */
export type StoredRepertoire = Repertoire & {
  updatedAt: number
  dirty: boolean
  /** Premier jour où une file FSRS a été utilisée (YYYY-MM-DD). */
  fsrsFirstDayKey?: string
  lastTrainDayKey?: string
}

export type StoredMove = Move & {
  updatedAt: number
  dirty: boolean
}

export type PendingDeleteSubtreeOp = {
  id?: number
  repertoireId: RepertoireId
  rootMoveId: MoveId
  createdAt: number
}

export type TrainRunKindStored = 'full' | 'selection' | 'failed' | 'random' | 'fsrs'

export type TrainRunRecord = {
  id: string
  repertoireId: RepertoireId
  endedAt: number
  dayKey: string
  kind: TrainRunKindStored
  scopeRootMoveId: MoveId | null
  totalPositions: number
  passed: number
  failed: number
  movesPlayed: number
}

export type TrainActivityDay = { dayKey: string }

export class ChessTrainerDB extends Dexie {
  repertoires!: Table<StoredRepertoire, string>
  moves!: Table<StoredMove, string>
  pendingDeleteSubtrees!: Table<PendingDeleteSubtreeOp, number>
  trainRuns!: Table<TrainRunRecord, string>
  trainActivityDays!: Table<TrainActivityDay, string>
  fsrsCards!: Table<StoredFsrsCard, string>

  constructor() {
    super('ChessTrainerSyncDB')

    this.version(1).stores({
      repertoires: 'id, side, createdAt, dirty',
      moves: 'id, repertoireId, parentId, [repertoireId+parentId], [repertoireId+fen], dirty',
      pendingDeleteSubtrees: '++id, repertoireId',
    })

    this.version(2).stores({
      repertoires: 'id, side, createdAt, dirty',
      moves: 'id, repertoireId, parentId, [repertoireId+parentId], [repertoireId+fen], dirty',
      pendingDeleteSubtrees: '++id, repertoireId',
      trainRuns: 'id, repertoireId, endedAt, dayKey',
      trainActivityDays: '&dayKey',
    })

    this.version(3).stores({
      repertoires: 'id, side, createdAt, dirty',
      moves: 'id, repertoireId, parentId, [repertoireId+parentId], [repertoireId+fen], dirty',
      pendingDeleteSubtrees: '++id, repertoireId',
      trainRuns: 'id, repertoireId, endedAt, dayKey',
      trainActivityDays: '&dayKey',
    })

    this.version(4).stores({
      repertoires: 'id, side, createdAt, dirty',
      moves: 'id, repertoireId, parentId, [repertoireId+parentId], [repertoireId+fen], dirty',
      pendingDeleteSubtrees: '++id, repertoireId',
      trainRuns: 'id, repertoireId, endedAt, dayKey',
      trainActivityDays: '&dayKey',
      fsrsCards: 'id, repertoireId, parentPositionKey, [repertoireId+parentPositionKey], due',
    })
  }
}

export const db = new ChessTrainerDB()

export function toPublicRepertoire(r: StoredRepertoire): Repertoire {
  return {
    id: r.id,
    title: r.title,
    side: r.side,
    createdAt: r.createdAt,
    trainStreak: r.trainStreak,
  }
}

export function toPublicMove(m: StoredMove): Move {
  return {
    id: m.id,
    repertoireId: m.repertoireId,
    parentId: m.parentId,
    fen: m.fen,
    notation: m.notation,
    nag: m.nag,
    comment: m.comment,
    eval: m.eval,
    createdAt: m.createdAt,
    isMainLine: m.isMainLine,
  }
}

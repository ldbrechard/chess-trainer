import Dexie, { type Table } from 'dexie'

export type Side = 'white' | 'black'

export type Repertoire = {
  id?: number
  title: string
  side: Side
  createdAt: number
}

export type Move = {
  id?: number
  repertoireId: number
  parentId: number | null
  fen: string
  notation: string
  comment: string
  eval?: number
}

export class ChessTrainerDB extends Dexie {
  repertoires!: Table<Repertoire, number>
  moves!: Table<Move, number>

  constructor() {
    super('ChessTrainerDB')

    this.version(1).stores({
      // Common list queries: by side, sort by createdAt
      repertoires: '++id, side, createdAt',
      // Tree queries: children by (repertoireId, parentId); transpositions by fen
      moves: '++id, repertoireId, parentId, fen, [repertoireId+parentId], [repertoireId+fen]',
    })
  }
}

export const db = new ChessTrainerDB()


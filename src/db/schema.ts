export type Side = 'white' | 'black'

export type RepertoireId = string
export type MoveId = string

export type Repertoire = {
  id: RepertoireId
  title: string
  side: Side
  createdAt: number
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
  /** ISO timestamp from DB; used for stable sibling ordering */
  createdAt?: string
}

import { useCallback, useMemo, useState } from 'react'
import { db, type Move, type Repertoire, type Side } from '../db/schema'

export type CreateRepertoireInput = {
  title: string
  side: Side
}

export type AddMoveInput = {
  repertoireId: number
  parentId: number | null
  fen: string
  notation: string
  comment?: string
  eval?: number
}

export function useRepertoire() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const createRepertoire = useCallback(async (input: CreateRepertoireInput) => {
    setLoading(true)
    setError(null)
    try {
      const repertoire: Repertoire = {
        title: input.title,
        side: input.side,
        createdAt: Date.now(),
      }
      const id = await db.repertoires.add(repertoire)
      return id
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  const addMove = useCallback(async (input: AddMoveInput) => {
    setLoading(true)
    setError(null)
    try {
      const move: Move = {
        repertoireId: input.repertoireId,
        parentId: input.parentId,
        fen: input.fen,
        notation: input.notation,
        comment: input.comment ?? '',
        eval: input.eval,
      }
      const id = await db.moves.add(move)
      return id
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setLoading(false)
    }
  }, [])

  return useMemo(
    () => ({
      loading,
      error,
      createRepertoire,
      addMove,
    }),
    [addMove, createRepertoire, error, loading],
  )
}


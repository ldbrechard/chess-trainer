import { useCallback, useMemo, useState } from 'react'
import type { Move, Side } from '../db/schema'
import { addMove as addMoveDb, createRepertoire as createRepertoireDb } from '../db/repertoireRepo'

export type CreateRepertoireInput = {
  title: string
  side: Side
}

export type AddMoveInput = {
  repertoireId: string
  parentId: string | null
  fen: string
  notation: string
  comment?: string
  eval?: number
  nag?: string
}

export function useRepertoire() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const createRepertoire = useCallback(async (input: CreateRepertoireInput) => {
    setLoading(true)
    setError(null)
    try {
      return await createRepertoireDb({ title: input.title, side: input.side })
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
      const move: Omit<Move, 'id' | 'createdAt'> = {
        repertoireId: input.repertoireId,
        parentId: input.parentId,
        fen: input.fen,
        notation: input.notation,
        nag: input.nag,
        comment: input.comment ?? '',
        eval: input.eval,
      }
      return await addMoveDb(move)
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

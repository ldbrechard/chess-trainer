import { useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { Key } from 'chessground/types'

import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

type Props = {
  fen: string
  dests: Map<Key, Key[]>
  turnColor: 'white' | 'black'
  orientation?: 'white' | 'black'
  lastMove?: [Key, Key] | null
  selectedSquare?: Key | null
  onMove?: (from: Key, to: Key) => void | Promise<void>
}

export function Board({
  fen,
  dests,
  turnColor,
  orientation = 'white',
  lastMove,
  selectedSquare,
  onMove,
}: Props) {
  const cgRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<Api | null>(null)

  useEffect(() => {
    if (!cgRef.current) return
    const el = cgRef.current

    const api = Chessground(el, {
      orientation,
      coordinates: true,
      turnColor,
      movable: {
        free: false,
        color: turnColor,
        dests,
        events: {
          after: async (from, to) => {
            const fromKey = from as Key
            const toKey = to as Key
            // Revert immediately; parent state is the source of truth.
            api.set({ fen })
            await onMove?.(fromKey, toKey)
          },
        },
      },
      lastMove: lastMove ?? undefined,
      selected: selectedSquare ?? undefined,
      fen,
    })

    apiRef.current = api
    return () => {
      apiRef.current = null
      // chessground doesn't expose a hard destroy in all builds; clearing DOM is enough.
      el.innerHTML = ''
    }
  }, [dests, fen, lastMove, onMove, orientation, selectedSquare, turnColor])

  useEffect(() => {
    apiRef.current?.set({
      fen,
      lastMove: lastMove ?? undefined,
      selected: selectedSquare ?? undefined,
      turnColor,
      movable: { color: turnColor, dests },
    })
  }, [dests, fen, lastMove, selectedSquare, turnColor])

  return (
    <div className="aspect-square w-full">
      <div ref={cgRef} className="h-full w-full" />
    </div>
  )
}


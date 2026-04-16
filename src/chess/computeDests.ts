import type { Chess } from 'chess.js'
import type { Key } from 'chessground/types'

export function computeDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>()
  const moves = chess.moves({ verbose: true })
  for (const m of moves) {
    const from = m.from as Key
    const to = m.to as Key
    const list = dests.get(from)
    if (list) list.push(to)
    else dests.set(from, [to])
  }
  return dests
}


import type { Move } from '../db/schema'

export type MoveNode = {
  move: Move
  children: MoveNode[]
}

export type MoveForest = MoveNode[]

export function buildMoveForest(moves: Move[]): MoveForest {
  const byParent = new Map<number | null, Move[]>()
  for (const m of moves) {
    const key = m.parentId ?? null
    const list = byParent.get(key)
    if (list) list.push(m)
    else byParent.set(key, [m])
  }

  const build = (parentId: number | null): MoveNode[] => {
    const list = byParent.get(parentId) ?? []
    // Stable order (roughly creation order) for deterministic UI.
    list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
    return list.map((move) => ({
      move,
      children: build(move.id ?? -1),
    }))
  }

  return build(null)
}

export function pathToIdSet(path: Move[]): Set<number> {
  const s = new Set<number>()
  for (const m of path) if (m.id != null) s.add(m.id)
  return s
}

export function collectLeafPaths(forest: MoveForest): Move[][] {
  const out: Move[][] = []

  const walk = (nodes: MoveNode[], acc: Move[]) => {
    for (const n of nodes) {
      const next = [...acc, n.move]
      if (n.children.length === 0) out.push(next)
      else walk(n.children, next)
    }
  }

  walk(forest, [])
  return out
}


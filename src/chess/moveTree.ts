import type { Move } from '../db/schema'

export type MoveNode = {
  move: Move
  children: MoveNode[]
}

export type MoveForest = MoveNode[]

function siblingSortKey(m: Move): string {
  return `${m.createdAt ?? ''}\t${m.id}`
}

export function buildMoveForest(moves: Move[]): MoveForest {
  const byParent = new Map<string | null, Move[]>()
  for (const m of moves) {
    const key = m.parentId ?? null
    const list = byParent.get(key)
    if (list) list.push(m)
    else byParent.set(key, [m])
  }

  const build = (parentId: string | null): MoveNode[] => {
    const list = byParent.get(parentId) ?? []
    list.sort((a, b) => siblingSortKey(a).localeCompare(siblingSortKey(b)))
    return list.map((move) => ({
      move,
      children: build(move.id),
    }))
  }

  return build(null)
}

export function pathToIdSet(path: Move[]): Set<string> {
  const s = new Set<string>()
  for (const m of path) s.add(m.id)
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

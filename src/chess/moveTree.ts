import type { Move } from '../db/schema'

export type MoveNode = {
  move: Move
  children: MoveNode[]
}

export type MoveForest = MoveNode[]

function siblingSortKey(m: Move): string {
  return `${m.createdAt ?? ''}\t${m.id}`
}

/** Main line first, then stable creation order. */
export function compareSiblings(a: Move, b: Move): number {
  const ma = a.isMainLine ? 1 : 0
  const mb = b.isMainLine ? 1 : 0
  if (ma !== mb) return mb - ma
  return siblingSortKey(a).localeCompare(siblingSortKey(b))
}

export function pickMainLineChild(children: Move[]): Move | undefined {
  if (children.length === 0) return undefined
  const flagged = children.filter((c) => c.isMainLine)
  if (flagged.length === 1) return flagged[0]
  if (flagged.length > 1) return [...children].sort(compareSiblings)[0]
  return [...children].sort(compareSiblings)[0]
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
    list.sort(compareSiblings)
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

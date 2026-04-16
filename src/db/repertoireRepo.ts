import { db, type Move, type Repertoire, type Side } from './schema'

export async function listRepertoires(): Promise<Repertoire[]> {
  return await db.repertoires.orderBy('createdAt').reverse().toArray()
}

export async function createRepertoire(input: {
  title: string
  side: Side
}): Promise<number> {
  const repertoire: Repertoire = {
    title: input.title.trim(),
    side: input.side,
    createdAt: Date.now(),
  }
  return await db.repertoires.add(repertoire)
}

export async function getRepertoire(id: number): Promise<Repertoire | undefined> {
  return await db.repertoires.get(id)
}

export async function listChildrenMoves(input: {
  repertoireId: number
  parentId: number | null
}): Promise<Move[]> {
  // NOTE: even though we have a compound index, filtering on `parentId = null`
  // can be tricky across typings/runtime. Keep it simple & reliable for v1.
  return await db.moves
    .where('repertoireId')
    .equals(input.repertoireId)
    .and((m) => m.parentId === input.parentId)
    .sortBy('id')
}

export async function getMove(id: number): Promise<Move | undefined> {
  return await db.moves.get(id)
}

export async function addMove(input: Omit<Move, 'id'>): Promise<number> {
  return await db.moves.add(input)
}

export async function listAllMoves(repertoireId: number): Promise<Move[]> {
  return await db.moves.where('repertoireId').equals(repertoireId).sortBy('id')
}

export async function deleteMoveSubtree(input: {
  repertoireId: number
  rootMoveId: number
}): Promise<number> {
  const moves = await listAllMoves(input.repertoireId)
  const childrenByParent = new Map<number, number[]>()

  for (const m of moves) {
    if (m.parentId == null || m.id == null) continue
    const list = childrenByParent.get(m.parentId)
    if (list) list.push(m.id)
    else childrenByParent.set(m.parentId, [m.id])
  }

  const toDelete = new Set<number>()
  const stack: number[] = [input.rootMoveId]
  while (stack.length) {
    const id = stack.pop()!
    if (toDelete.has(id)) continue
    toDelete.add(id)
    const kids = childrenByParent.get(id)
    if (kids) stack.push(...kids)
  }

  const ids = [...toDelete]
  await db.moves.bulkDelete(ids)
  return ids.length
}


import { deleteFsrsCardsForRepertoire } from './fsrsRepo'
import {
  scheduleRepertoireSync,
  tryRemoteDeleteRepertoire,
  tryRemoteDeleteSubtree,
} from '../sync/repertoireSync'
import { compareSiblings } from '../chess/moveTree'
import { db, toPublicMove, toPublicRepertoire, type Move, type Repertoire, type Side, type StoredMove, type StoredRepertoire } from './schema'

function nowMs() {
  return Date.now()
}

function newIso() {
  return new Date().toISOString()
}

export async function listRepertoires(): Promise<Repertoire[]> {
  const rows = await db.repertoires.orderBy('createdAt').reverse().toArray()
  return rows.map(toPublicRepertoire)
}

export async function createRepertoire(input: { title: string; description?: string; side: Side }): Promise<string> {
  const id = crypto.randomUUID()
  const t = nowMs()
  const row: StoredRepertoire = {
    id,
    title: input.title.trim(),
    description: input.description?.trim() ? input.description.trim().slice(0, 140) : undefined,
    side: input.side,
    createdAt: t,
    notificationsEnabled: false,
    updatedAt: t,
    dirty: true,
  }
  await db.repertoires.add(row)
  scheduleRepertoireSync()
  return id
}

export type BulkImportMoveInput = {
  id: string
  parentId: string | null
  fen: string
  notation: string
  nag?: string
  comment: string
}

/**
 * PGN import order (see `walkMoves` in pgnImportExport): at each fork, variations are emitted
 * before the main continuation, so the last row per `parentId` is the main-line child.
 */
function mainLineIdsFromImportOrder(moves: BulkImportMoveInput[]): Set<string> {
  const lastIdByParent = new Map<string | null, string>()
  for (const m of moves) {
    lastIdByParent.set(m.parentId, m.id)
  }
  return new Set(lastIdByParent.values())
}

/** Insert many moves in one repertoire (import PGN). Caller must provide unique ids and valid parent chain. */
export async function bulkInsertMovesForRepertoire(repertoireId: string, moves: BulkImportMoveInput[]): Promise<void> {
  if (moves.length === 0) return
  const t = nowMs()
  const base = Date.now()
  const mainIds = mainLineIdsFromImportOrder(moves)
  const rows: StoredMove[] = moves.map((m, i) => ({
    id: m.id,
    repertoireId,
    parentId: m.parentId,
    fen: m.fen,
    notation: m.notation,
    nag: m.nag?.trim() ? m.nag.trim() : undefined,
    comment: m.comment ?? '',
    isMainLine: mainIds.has(m.id) ? true : undefined,
    createdAt: new Date(base + i).toISOString(),
    updatedAt: t,
    dirty: true,
  }))
  await db.moves.bulkAdd(rows)
  await db.repertoires.update(repertoireId, { dirty: true, updatedAt: t })
  scheduleRepertoireSync()
}

export async function getRepertoire(id: string): Promise<Repertoire | undefined> {
  const r = await db.repertoires.get(id)
  return r ? toPublicRepertoire(r) : undefined
}

/** Exactly one sibling per parent may be main line. */
export async function promoteMoveToMainLine(moveId: string): Promise<void> {
  const m = await db.moves.get(moveId)
  if (!m) return
  const t = nowMs()
  const siblings = await db.moves
    .where('repertoireId')
    .equals(m.repertoireId)
    .and((row) => row.parentId === m.parentId)
    .toArray()
  for (const s of siblings) {
    await db.moves.update(s.id, {
      isMainLine: s.id === moveId ? true : undefined,
      dirty: true,
      updatedAt: t,
    })
  }
  await db.repertoires.update(m.repertoireId, { dirty: true, updatedAt: t })
  scheduleRepertoireSync()
}

/** Move a variation earlier among siblings (without changing main-line flag). */
export async function promoteVariation(moveId: string): Promise<void> {
  const m = await db.moves.get(moveId)
  if (!m) return
  const siblings = await db.moves
    .where('repertoireId')
    .equals(m.repertoireId)
    .and((row) => row.parentId === m.parentId)
    .toArray()
  if (siblings.length < 2) return
  const otherTimes = siblings
    .filter((s) => s.id !== m.id)
    .map((s) => (s.createdAt ? Date.parse(s.createdAt) : Number.NaN))
    .filter((n) => Number.isFinite(n))
  if (otherTimes.length === 0) return
  const minOther = Math.min(...otherTimes)
  const createdAt = new Date(Math.max(0, minOther - 1)).toISOString()
  const t = nowMs()
  await db.moves.update(m.id, { createdAt, dirty: true, updatedAt: t })
  await db.repertoires.update(m.repertoireId, { dirty: true, updatedAt: t })
  scheduleRepertoireSync()
}

export async function deleteRepertoire(id: string): Promise<void> {
  const existing = await db.repertoires.get(id)
  if (!existing) return
  await db.moves.where('repertoireId').equals(id).delete()
  await db.trainRuns.where('repertoireId').equals(id).delete()
  await deleteFsrsCardsForRepertoire(id)
  await db.pendingDeleteSubtrees.where('repertoireId').equals(id).delete()
  await db.repertoires.delete(id)
  void tryRemoteDeleteRepertoire(id)
  scheduleRepertoireSync()
}

export async function updateRepertoireTitle(id: string, title: string): Promise<void> {
  const t = title.trim().slice(0, 80)
  if (!t) return
  if (!(await db.repertoires.get(id))) return
  const now = nowMs()
  await db.repertoires.update(id, { title: t, dirty: true, updatedAt: now })
  scheduleRepertoireSync()
}

export async function updateRepertoireMetadata(
  id: string,
  patch: { title?: string; description?: string | undefined },
): Promise<void> {
  const existing = await db.repertoires.get(id)
  if (!existing) return
  const next: Partial<StoredRepertoire> = {}
  if (patch.title !== undefined) {
    const title = patch.title.trim().slice(0, 80)
    if (!title) return
    next.title = title
  }
  if (patch.description !== undefined) {
    const description = patch.description.trim()
    next.description = description ? description.slice(0, 140) : undefined
  }
  if (Object.keys(next).length === 0) return
  const now = nowMs()
  await db.repertoires.update(id, { ...next, dirty: true, updatedAt: now })
  scheduleRepertoireSync()
}

/** Local-only notification preferences/markers (not synced to cloud). */
export async function updateRepertoireNotificationSettings(
  id: string,
  patch: Partial<Pick<StoredRepertoire, 'notificationsEnabled' | 'lastDailyReminderDayKey' | 'lastInactivityReminderDayKey'>>,
): Promise<void> {
  if (!(await db.repertoires.get(id))) return
  await db.repertoires.update(id, patch)
}

export async function listChildrenMoves(input: {
  repertoireId: string
  parentId: string | null
}): Promise<Move[]> {
  const rows = await db.moves
    .where('repertoireId')
    .equals(input.repertoireId)
    .and((m) => m.parentId === input.parentId)
    .toArray()
  rows.sort(compareSiblings)
  return rows.map(toPublicMove)
}

export async function getMove(id: string): Promise<Move | undefined> {
  const m = await db.moves.get(id)
  return m ? toPublicMove(m) : undefined
}

export async function addMove(input: Omit<Move, 'id' | 'createdAt'>): Promise<string> {
  const id = crypto.randomUUID()
  const t = nowMs()
  const iso = newIso()
  const row: StoredMove = {
    id,
    repertoireId: input.repertoireId,
    parentId: input.parentId,
    fen: input.fen,
    notation: input.notation,
    nag: input.nag?.trim() ? input.nag.trim() : undefined,
    comment: input.comment ?? '',
    eval: input.eval,
    isMainLine: input.isMainLine,
    createdAt: iso,
    updatedAt: t,
    dirty: true,
  }
  await db.moves.add(row)
  await db.repertoires.update(input.repertoireId, { dirty: true, updatedAt: t })
  scheduleRepertoireSync()
  return id
}

export async function updateMove(
  id: string,
  changes: Partial<Omit<Move, 'id' | 'repertoireId' | 'parentId' | 'fen' | 'notation' | 'createdAt'>>,
): Promise<void> {
  const existing = await db.moves.get(id)
  if (!existing) return
  const t = nowMs()
  const patch: Partial<StoredMove> = { dirty: true, updatedAt: t }
  if (changes.nag !== undefined) patch.nag = changes.nag?.trim() ? changes.nag.trim() : undefined
  if (changes.comment !== undefined) patch.comment = changes.comment
  if (changes.eval !== undefined) patch.eval = changes.eval
  if (changes.isMainLine !== undefined) patch.isMainLine = changes.isMainLine ? true : undefined
  await db.moves.update(id, patch)
  await db.repertoires.update(existing.repertoireId, { dirty: true, updatedAt: t })
  scheduleRepertoireSync()
}

export async function listAllMoves(repertoireId: string): Promise<Move[]> {
  const rows = await db.moves.where('repertoireId').equals(repertoireId).toArray()
  rows.sort((a, b) => `${a.createdAt ?? ''}\t${a.id}`.localeCompare(`${b.createdAt ?? ''}\t${b.id}`))
  return rows.map(toPublicMove)
}

export async function deleteMoveSubtree(input: { repertoireId: string; rootMoveId: string }): Promise<void> {
  const moves = await listAllMovesInternal(input.repertoireId)
  const childrenByParent = new Map<string | null, string[]>()

  for (const m of moves) {
    if (m.parentId == null) continue
    const list = childrenByParent.get(m.parentId)
    if (list) list.push(m.id)
    else childrenByParent.set(m.parentId, [m.id])
  }

  const toDelete = new Set<string>()
  const stack: string[] = [input.rootMoveId]
  while (stack.length) {
    const id = stack.pop()!
    if (toDelete.has(id)) continue
    toDelete.add(id)
    const kids = childrenByParent.get(id)
    if (kids) stack.push(...kids)
  }

  const ids = [...toDelete]
  await db.moves.bulkDelete(ids)
  const t = nowMs()
  await db.repertoires.update(input.repertoireId, { dirty: true, updatedAt: t })

  const remoteOk = await tryRemoteDeleteSubtree(input.repertoireId, input.rootMoveId)
  if (!remoteOk) {
    await db.pendingDeleteSubtrees.add({
      repertoireId: input.repertoireId,
      rootMoveId: input.rootMoveId,
      createdAt: t,
    })
  }
  scheduleRepertoireSync()
}

async function listAllMovesInternal(repertoireId: string): Promise<StoredMove[]> {
  return await db.moves.where('repertoireId').equals(repertoireId).sortBy('id')
}

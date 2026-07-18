import type { Side, StoredMove, StoredRepertoire } from '../db/schema'

export type RepRow = {
  id: string
  user_id: string
  title: string
  side: string
  created_at: string
  updated_at?: string
}

export type MoveRow = {
  id: string
  repertoire_id: string
  parent_id: string | null
  fen: string
  notation: string
  nag: string | null
  comment: string | null
  eval: number | null
  is_main_line?: boolean | null
  created_at: string
  updated_at?: string
}

export function ts(row: { updated_at?: string; created_at?: string }): number {
  const u = row.updated_at ?? row.created_at
  return u ? new Date(u).getTime() : 0
}

export function remoteToStoredRep(r: RepRow, local?: StoredRepertoire): StoredRepertoire {
  return {
    id: r.id,
    title: r.title,
    description: local?.description,
    side: r.side as Side,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: ts(r),
    dirty: false,
    trainStreak: local?.trainStreak,
    lastTrainDayKey: local?.lastTrainDayKey,
    fsrsFirstDayKey: local?.fsrsFirstDayKey,
    notificationsEnabled: local?.notificationsEnabled ?? false,
    lastDailyReminderDayKey: local?.lastDailyReminderDayKey,
    lastInactivityReminderDayKey: local?.lastInactivityReminderDayKey,
  }
}

export function remoteToStoredMove(r: MoveRow): StoredMove {
  return {
    id: r.id,
    repertoireId: r.repertoire_id,
    parentId: r.parent_id,
    fen: r.fen,
    notation: r.notation,
    nag: r.nag ?? undefined,
    comment: r.comment ?? '',
    eval: r.eval ?? undefined,
    isMainLine: r.is_main_line ? true : undefined,
    createdAt: r.created_at,
    updatedAt: ts(r),
    dirty: false,
  }
}

/** Prefer remote when local is clean and remote is newer or equal. */
export function shouldPullRemoteOverLocal(
  local: { dirty: boolean; updatedAt: number } | undefined,
  remoteUpdatedAt: number,
): boolean {
  if (!local) return true
  if (local.dirty) return false
  return remoteUpdatedAt >= local.updatedAt
}

/** Parents before children among dirty moves so remote upserts do not violate FK order. */
export function sortMovesForUpsert<T extends { id: string; parentId: string | null }>(moves: T[]): T[] {
  const dirtyIds = new Set(moves.map((m) => m.id))
  const out: T[] = []
  const placed = new Set<string>()
  let safety = 0
  while (out.length < moves.length && safety < moves.length * 4) {
    safety += 1
    let progressed = false
    for (const m of moves) {
      if (placed.has(m.id)) continue
      const pid = m.parentId
      const parentReady = pid == null || !dirtyIds.has(pid) || placed.has(pid)
      if (parentReady) {
        out.push(m)
        placed.add(m.id)
        progressed = true
      }
    }
    if (!progressed) break
  }
  for (const m of moves) if (!placed.has(m.id)) out.push(m)
  return out
}

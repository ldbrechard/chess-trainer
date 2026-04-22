import type { SupabaseClient } from '@supabase/supabase-js'
import { db, type Side, type StoredMove, type StoredRepertoire } from '../db/schema'
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient'

type RepRow = {
  id: string
  user_id: string
  title: string
  side: string
  created_at: string
  updated_at?: string
}

type MoveRow = {
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

let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function scheduleRepertoireSync(): void {
  if (!isSupabaseConfigured()) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    void runRepertoireSync()
  }, 900)
}

function ts(row: { updated_at?: string; created_at?: string }): number {
  const u = row.updated_at ?? row.created_at
  return u ? new Date(u).getTime() : 0
}

function remoteToStoredRep(r: RepRow, local?: StoredRepertoire): StoredRepertoire {
  return {
    id: r.id,
    title: r.title,
    description: local?.description,
    side: r.side as Side,
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: ts(r),
    dirty: false,
    // Preserve local-only training metadata (not stored remotely).
    trainStreak: local?.trainStreak,
    lastTrainDayKey: local?.lastTrainDayKey,
    fsrsFirstDayKey: local?.fsrsFirstDayKey,
    notificationsEnabled: local?.notificationsEnabled ?? false,
    lastDailyReminderDayKey: local?.lastDailyReminderDayKey,
    lastInactivityReminderDayKey: local?.lastInactivityReminderDayKey,
  }
}

function remoteToStoredMove(r: MoveRow): StoredMove {
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

async function pullRemoteIntoDexie(supabase: SupabaseClient): Promise<void> {
  const { data: reps, error: e1 } = await supabase.from('repertoires').select('*').order('created_at', { ascending: false })
  if (e1) throw e1
  const remoteReps = (reps ?? []) as RepRow[]

  for (const r of remoteReps) {
    const local = await db.repertoires.get(r.id)
    const remoteT = ts(r)
    if (!local) {
      await db.repertoires.put(remoteToStoredRep(r))
      await replaceMovesFromRemote(supabase, r.id)
      continue
    }
    if (local.dirty) continue
    if (remoteT >= local.updatedAt) {
      await db.repertoires.put(remoteToStoredRep(r, local))
      await replaceMovesFromRemote(supabase, r.id)
    }
  }
}

async function replaceMovesFromRemote(supabase: SupabaseClient, repertoireId: string): Promise<void> {
  const { data: rows, error } = await supabase
    .from('moves')
    .select('*')
    .eq('repertoire_id', repertoireId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  const moves = (rows ?? []) as MoveRow[]
  await db.moves.where('repertoireId').equals(repertoireId).delete()
  if (moves.length) await db.moves.bulkAdd(moves.map(remoteToStoredMove))
}

function sortMovesForUpsert(moves: StoredMove[]): StoredMove[] {
  const dirtyIds = new Set(moves.map((m) => m.id))
  const out: StoredMove[] = []
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

async function pushDirtyToRemote(supabase: SupabaseClient, userId: string): Promise<void> {
  const nowIso = new Date().toISOString()

  const dirtyReps = await db.repertoires.filter((r) => r.dirty === true).toArray()
  for (const r of dirtyReps) {
    const { error } = await supabase.from('repertoires').upsert(
      {
        id: r.id,
        user_id: userId,
        title: r.title,
        side: r.side,
        updated_at: nowIso,
      },
      { onConflict: 'id' },
    )
    if (error) throw error
    await db.repertoires.update(r.id, { dirty: false, updatedAt: Date.now() })
  }

  const dirtyMoves = await db.moves.filter((m) => m.dirty === true).toArray()
  const ordered = sortMovesForUpsert(dirtyMoves)
  for (const m of ordered) {
    const nag = m.nag?.trim() ? m.nag.trim() : null
    const { error } = await supabase.from('moves').upsert(
      {
        id: m.id,
        repertoire_id: m.repertoireId,
        parent_id: m.parentId,
        fen: m.fen,
        notation: m.notation,
        nag,
        comment: m.comment ?? '',
        eval: m.eval ?? null,
        is_main_line: m.isMainLine === true,
        updated_at: nowIso,
      },
      { onConflict: 'id' },
    )
    if (error) throw error
    await db.moves.update(m.id, { dirty: false, updatedAt: Date.now() })
  }
}

async function flushPendingDeletes(supabase: SupabaseClient): Promise<void> {
  const ops = await db.pendingDeleteSubtrees.toArray()
  for (const op of ops) {
    if (op.id == null) continue
    const { error } = await supabase
      .from('moves')
      .delete()
      .eq('id', op.rootMoveId)
      .eq('repertoire_id', op.repertoireId)
    if (error) continue
    await db.pendingDeleteSubtrees.delete(op.id)
  }
}

export async function runRepertoireSync(): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: true }
  if (!navigator.onLine) return { ok: true }

  let supabase: SupabaseClient
  try {
    supabase = getSupabaseClient()
  } catch {
    return { ok: true }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: true }

  try {
    await pullRemoteIntoDexie(supabase)
    await pushDirtyToRemote(supabase, user.id)
    await flushPendingDeletes(supabase)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function tryRemoteDeleteSubtree(repertoireId: string, rootMoveId: string): Promise<boolean> {
  if (!isSupabaseConfigured() || !navigator.onLine) return false
  try {
    const supabase = getSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase.from('moves').delete().eq('id', rootMoveId).eq('repertoire_id', repertoireId)
    return !error
  } catch {
    return false
  }
}

/** Supprime le répertoire côté serveur (les coups suivent en cascade). */
export async function tryRemoteDeleteRepertoire(repertoireId: string): Promise<boolean> {
  if (!isSupabaseConfigured() || !navigator.onLine) return false
  try {
    const supabase = getSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false
    const { error } = await supabase.from('repertoires').delete().eq('id', repertoireId).eq('user_id', user.id)
    return !error
  } catch {
    return false
  }
}

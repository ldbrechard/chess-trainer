import { getSupabaseClient } from '../lib/supabaseClient'
import type { Move, MoveId, Repertoire, RepertoireId, Side } from './schema'

type RepertoireRow = {
  id: string
  title: string
  side: string
  created_at: string
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
  created_at: string
}

function mapRepertoire(r: RepertoireRow): Repertoire {
  return {
    id: r.id,
    title: r.title,
    side: r.side as Side,
    createdAt: new Date(r.created_at).getTime(),
  }
}

function mapMove(r: MoveRow): Move {
  return {
    id: r.id,
    repertoireId: r.repertoire_id,
    parentId: r.parent_id,
    fen: r.fen,
    notation: r.notation,
    nag: r.nag ?? undefined,
    comment: r.comment ?? '',
    eval: r.eval ?? undefined,
    createdAt: r.created_at,
  }
}

export async function listRepertoires(): Promise<Repertoire[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('repertoires')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as RepertoireRow[]).map(mapRepertoire)
}

export async function createRepertoire(input: { title: string; side: Side }): Promise<RepertoireId> {
  const supabase = getSupabaseClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('repertoires')
    .insert({
      title: input.title.trim(),
      side: input.side,
      user_id: user.id,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function getRepertoire(id: RepertoireId): Promise<Repertoire | undefined> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('repertoires').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return undefined
  return mapRepertoire(data as RepertoireRow)
}

export async function listChildrenMoves(input: {
  repertoireId: RepertoireId
  parentId: MoveId | null
}): Promise<Move[]> {
  const supabase = getSupabaseClient()
  let q = supabase.from('moves').select('*').eq('repertoire_id', input.repertoireId)
  if (input.parentId === null) q = q.is('parent_id', null)
  else q = q.eq('parent_id', input.parentId)
  const { data, error } = await q.order('created_at', { ascending: true }).order('id', { ascending: true })
  if (error) throw error
  return (data as MoveRow[]).map(mapMove)
}

export async function getMove(id: MoveId): Promise<Move | undefined> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('moves').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return undefined
  return mapMove(data as MoveRow)
}

export async function addMove(input: Omit<Move, 'id' | 'createdAt'>): Promise<MoveId> {
  const supabase = getSupabaseClient()
  const nag = input.nag?.trim() ? input.nag.trim() : null
  const { data, error } = await supabase
    .from('moves')
    .insert({
      repertoire_id: input.repertoireId,
      parent_id: input.parentId,
      fen: input.fen,
      notation: input.notation,
      nag,
      comment: input.comment ?? '',
      eval: input.eval ?? null,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

export async function updateMove(
  id: MoveId,
  changes: Partial<Omit<Move, 'id' | 'repertoireId' | 'parentId' | 'fen' | 'notation' | 'createdAt'>>,
): Promise<void> {
  const supabase = getSupabaseClient()
  const patch: Record<string, unknown> = {}
  if (changes.nag !== undefined) patch.nag = changes.nag?.trim() ? changes.nag.trim() : null
  if (changes.comment !== undefined) patch.comment = changes.comment
  if (changes.eval !== undefined) patch.eval = changes.eval ?? null
  const { error } = await supabase.from('moves').update(patch).eq('id', id)
  if (error) throw error
}

export async function listAllMoves(repertoireId: RepertoireId): Promise<Move[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('moves')
    .select('*')
    .eq('repertoire_id', repertoireId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data as MoveRow[]).map(mapMove)
}

export async function deleteMoveSubtree(input: {
  repertoireId: RepertoireId
  rootMoveId: MoveId
}): Promise<void> {
  const supabase = getSupabaseClient()
  const { error } = await supabase
    .from('moves')
    .delete()
    .eq('id', input.rootMoveId)
    .eq('repertoire_id', input.repertoireId)
  if (error) throw error
}

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient'

const SHARED_REPERTOIRES_TABLE = 'shared_repertoires'

export type SharedRepertoireRow = {
  id: string
  repertoire_title: string
  side: 'white' | 'black'
  pgn_text: string
  created_at: string
  expires_at: string | null
  revoked: boolean
}

export async function createSharedRepertoireLink(input: {
  title: string
  side: 'white' | 'black'
  pgnText: string
  expiresInDays?: number
}): Promise<string> {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase is not configured.')
  }
  const supabase = getSupabaseClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('You must be signed in to share a repertoire.')

  const id = crypto.randomUUID()
  const days = input.expiresInDays ?? 30
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await supabase.from(SHARED_REPERTOIRES_TABLE).insert({
    id,
    owner_user_id: user.id,
    repertoire_title: input.title.slice(0, 120),
    side: input.side,
    pgn_text: input.pgnText,
    expires_at: expiresAt,
    revoked: false,
  })
  if (error) throw error

  return `${window.location.origin}/share/r/${id}`
}

export async function fetchSharedRepertoireById(id: string): Promise<SharedRepertoireRow | null> {
  if (!isSupabaseConfigured()) return null
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from(SHARED_REPERTOIRES_TABLE)
    .select('id,repertoire_title,side,pgn_text,created_at,expires_at,revoked')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as SharedRepertoireRow | null) ?? null
}


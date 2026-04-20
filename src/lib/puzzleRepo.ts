import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient'
import {
  type PuzzleDifficulty,
  type PuzzleRow,
  ratingRangeForDifficulty,
  shuffleArray,
} from './puzzleUtils'

const PUZZLES_TABLE = 'puzzles_v2'

export async function doesAnyPuzzleExistForOpeningTag(tag: string): Promise<boolean> {
  const t = tag.trim()
  if (!t) return false
  if (!isSupabaseConfigured()) return false
  const client = getSupabaseClient()
  const { data, error } = await client
    .from(PUZZLES_TABLE)
    .select('PuzzleId')
    .not('OpeningTags', 'is', null)
    .ilike('OpeningTags', `%${t}%`)
    .limit(1)
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

export async function fetchPuzzlesByOpeningTags(params: {
  openingTags: string[]
  difficulty: PuzzleDifficulty
  perTagLimit?: number
  totalLimit?: number
}): Promise<PuzzleRow[]> {
  const openingTags = [...new Set(params.openingTags.map((t) => t.trim()).filter(Boolean))]
  if (openingTags.length === 0) return []
  if (!isSupabaseConfigured()) return []

  const client = getSupabaseClient()
  const { min, max } = ratingRangeForDifficulty(params.difficulty)
  const perTagLimit = Math.max(10, params.perTagLimit ?? 60)
  const totalLimit = Math.max(10, params.totalLimit ?? 40)
  const maxTags = 12

  const selectedTags = openingTags.slice(0, maxTags)
  const orExpr = selectedTags
    .map((tag) => `OpeningTags.ilike.%${tag.replace(/[%]/g, '').replace(/,/g, ' ')}%`)
    .join(',')

  const query = client
    .from(PUZZLES_TABLE)
    .select('PuzzleId,FEN,Moves,Rating,Themes,OpeningTags,GameUrl')
    .not('OpeningTags', 'is', null)
    .or(orExpr)
    .gte('Rating', min)
    .lte('Rating', max)
    .limit(Math.max(totalLimit * 3, perTagLimit))

  const { data, error } = await query
  if (error) throw new Error(`Supabase puzzles query failed: ${error.message}`)
  const strict = (data as PuzzleRow[] | null) ?? []

  // Fallback: if no puzzle in selected difficulty, keep opening match but relax rating.
  if (strict.length === 0) {
    const { data: fallbackData, error: fallbackError } = await client
      .from(PUZZLES_TABLE)
      .select('PuzzleId,FEN,Moves,Rating,Themes,OpeningTags,GameUrl')
      .not('OpeningTags', 'is', null)
      .or(orExpr)
      .limit(Math.max(totalLimit * 2, perTagLimit))
    if (fallbackError) throw new Error(`Supabase puzzles query failed: ${fallbackError.message}`)
    return shuffleArray((fallbackData as PuzzleRow[] | null) ?? []).slice(0, totalLimit)
  }

  return shuffleArray(strict).slice(0, totalLimit)
}


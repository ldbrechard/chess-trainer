import { createEmptyCard, fsrs, Rating, type Card } from 'ts-fsrs'

import { db, type StoredFsrsCard } from './schema'
import { dayKeyFromTimestamp } from './trainStatsRepo'
import { scheduleRepertoireSync } from '../sync/repertoireSync'

const f = fsrs({
  enable_fuzz: false,
  enable_short_term: false,
})

const NEW_BASE = 5
const MAX_NEW_PER_DAY = 80

export function encodeParentKey(parentId: string | null): string {
  return parentId ?? '__root__'
}

export function decodeParentKey(key: string): string | null {
  return key === '__root__' ? null : key
}

function compositeId(repertoireId: string, parentKey: string): string {
  return `${repertoireId}::${parentKey}`
}

function storedToCard(row: StoredFsrsCard): Card {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    learning_steps: row.learning_steps,
    last_review: row.last_review != null ? new Date(row.last_review) : undefined,
  }
}

function cardToStored(repertoireId: string, parentKey: string, card: Card): StoredFsrsCard {
  return {
    id: compositeId(repertoireId, parentKey),
    repertoireId,
    parentPositionKey: parentKey,
    due: card.due.getTime(),
    stability: card.stability,
    difficulty: card.difficulty,
    scheduled_days: card.scheduled_days,
    elapsed_days: card.elapsed_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    learning_steps: card.learning_steps,
    last_review: card.last_review?.getTime(),
  }
}

function dayDiffKeys(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime()
  const b = new Date(`${to}T12:00:00`).getTime()
  return Math.round((b - a) / 86400000)
}

function endOfToday(now: Date): Date {
  const d = new Date(now)
  d.setHours(23, 59, 59, 999)
  return d
}

async function ensureFsrsFirstDayKey(repertoireId: string, todayKey: string): Promise<void> {
  const r = await db.repertoires.get(repertoireId)
  if (!r || r.fsrsFirstDayKey) return
  const t = Date.now()
  await db.repertoires.update(repertoireId, {
    fsrsFirstDayKey: todayKey,
    updatedAt: t,
    dirty: true,
  })
  scheduleRepertoireSync()
}

/**
 * File d’entraînement FSRS : d’abord les cartes dues (échéance ≤ fin de journée), puis des positions neuves selon un plafond qui augmente chaque jour calendaire.
 */
export async function buildFsrsTrainQueue(
  repertoireId: string,
  trainPositions: Array<string | null>,
  now = new Date(),
): Promise<Array<string | null>> {
  if (trainPositions.length === 0) return []

  const todayKey = dayKeyFromTimestamp(now.getTime())
  await ensureFsrsFirstDayKey(repertoireId, todayKey)

  const rep = await db.repertoires.get(repertoireId)
  const firstDay = rep?.fsrsFirstDayKey ?? todayKey
  const dayIdx = Math.max(0, dayDiffKeys(firstDay, todayKey))
  const maxNew = Math.min(MAX_NEW_PER_DAY, NEW_BASE + dayIdx)

  const rows = await db.fsrsCards.where('repertoireId').equals(repertoireId).toArray()
  const byKey = new Map(rows.map((r) => [r.parentPositionKey, r]))

  const eod = endOfToday(now).getTime()

  type DueItem = { pos: string | null; due: number }
  const dueList: DueItem[] = []

  for (const pos of trainPositions) {
    const key = encodeParentKey(pos)
    const row = byKey.get(key)
    if (!row) continue
    const card = storedToCard(row)
    if (card.due.getTime() <= eod) {
      dueList.push({ pos, due: card.due.getTime() })
    }
  }
  dueList.sort((a, b) => a.due - b.due)

  const seenKeys = new Set(rows.map((r) => r.parentPositionKey))
  const unseen = trainPositions.filter((pos) => !seenKeys.has(encodeParentKey(pos)))

  const shuffled = [...unseen]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const newPicks = shuffled.slice(0, Math.min(maxNew, shuffled.length))

  const out: Array<string | null> = []
  const seen = new Set<string>()
  const mark = (p: string | null) => {
    const k = encodeParentKey(p)
    if (seen.has(k)) return
    seen.add(k)
    out.push(p)
  }

  for (const d of dueList) mark(d.pos)
  for (const p of newPicks) mark(p)

  return out
}

export async function recordPositionFsrsReview(
  repertoireId: string,
  parentId: string | null,
  outcome: 'good' | 'again',
  now = new Date(),
): Promise<void> {
  const key = encodeParentKey(parentId)
  const id = compositeId(repertoireId, key)
  const existing = await db.fsrsCards.get(id)
  const base: Card = existing ? storedToCard(existing) : createEmptyCard(now)
  const grade = outcome === 'good' ? Rating.Good : Rating.Again
  const { card: next } = f.next(base, now, grade)
  const row = cardToStored(repertoireId, key, next)
  await db.fsrsCards.put(row)
}

export async function deleteFsrsCardsForRepertoire(repertoireId: string): Promise<void> {
  await db.fsrsCards.where('repertoireId').equals(repertoireId).delete()
}

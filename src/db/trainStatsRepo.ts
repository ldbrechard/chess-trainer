import { db, type TrainRunRecord } from './schema'
import { scheduleRepertoireSync } from '../sync/repertoireSync'

export type { TrainRunRecord } from './schema'

export function dayKeyFromTimestamp(ms: number): string {
  const d = new Date(ms)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayBeforeLocal(dayKey: string): string {
  const [y, mo, da] = dayKey.split('-').map(Number)
  const d = new Date(y, mo - 1, da)
  d.setDate(d.getDate() - 1)
  return dayKeyFromTimestamp(d.getTime())
}

export async function touchTrainActivityDay(ts = Date.now()): Promise<void> {
  const dayKey = dayKeyFromTimestamp(ts)
  await db.trainActivityDays.put({ dayKey })
}

export async function insertTrainRun(
  input: Omit<TrainRunRecord, 'id' | 'endedAt' | 'dayKey'> & { endedAt?: number },
): Promise<void> {
  const endedAt = input.endedAt ?? Date.now()
  const row: TrainRunRecord = {
    id: crypto.randomUUID(),
    repertoireId: input.repertoireId,
    endedAt,
    dayKey: dayKeyFromTimestamp(endedAt),
    kind: input.kind,
    scopeRootMoveId: input.scopeRootMoveId,
    totalPositions: input.totalPositions,
    passed: input.passed,
    failed: input.failed,
    movesPlayed: input.movesPlayed,
  }
  await db.trainRuns.add(row)
  await touchTrainActivityDay(endedAt)
  await bumpRepertoireTrainStreak(input.repertoireId, endedAt)
}

/** Incrémente la série de jours consécutifs pour ce répertoire (après un run terminé). */
export async function bumpRepertoireTrainStreak(repertoireId: string, endedAt: number): Promise<void> {
  const today = dayKeyFromTimestamp(endedAt)
  const row = await db.repertoires.get(repertoireId)
  if (!row) return
  const last = row.lastTrainDayKey
  const prev = row.trainStreak ?? 0
  let next = 1
  if (last === today) {
    next = prev
  } else if (last === dayBeforeLocal(today)) {
    next = prev + 1
  } else {
    next = 1
  }
  await db.repertoires.update(repertoireId, {
    trainStreak: next,
    lastTrainDayKey: today,
    updatedAt: Date.now(),
    dirty: true,
  })
  scheduleRepertoireSync()
}

export async function listTrainRuns(filter: { repertoireId?: string | 'all' }): Promise<TrainRunRecord[]> {
  const rows = await db.trainRuns.orderBy('endedAt').reverse().toArray()
  if (!filter.repertoireId || filter.repertoireId === 'all') return rows
  return rows.filter((r) => r.repertoireId === filter.repertoireId)
}

export async function computeCurrentStreak(): Promise<number> {
  const days = await db.trainActivityDays.toArray()
  if (days.length === 0) return 0
  const set = new Set(days.map((d) => d.dayKey))
  const today = dayKeyFromTimestamp(Date.now())

  let anchor = today
  if (!set.has(today)) {
    anchor = dayBeforeLocal(today)
    if (!set.has(anchor)) return 0
  }

  let streak = 0
  let cur = anchor
  while (set.has(cur)) {
    streak += 1
    cur = dayBeforeLocal(cur)
  }
  return streak
}

export type TrainAggregateStats = {
  totalRuns: number
  totalMovesPlayed: number
  avgSuccessRatePerRun: number | null
}

export async function computeAggregateStats(filter: { repertoireId: string | 'all' }): Promise<TrainAggregateStats> {
  const runs = await listTrainRuns({ repertoireId: filter.repertoireId })
  if (runs.length === 0) {
    return { totalRuns: 0, totalMovesPlayed: 0, avgSuccessRatePerRun: null }
  }
  const totalMovesPlayed = runs.reduce((s, r) => s + r.movesPlayed, 0)
  const rates = runs
    .map((r) => (r.totalPositions > 0 ? r.passed / r.totalPositions : null))
    .filter((x): x is number => x != null)
  const avgSuccessRatePerRun = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null
  return { totalRuns: runs.length, totalMovesPlayed, avgSuccessRatePerRun }
}

export type DayMoveCount = { dayKey: string; moves: number }

/** Sums `movesPlayed` by local calendar `dayKey` for the last `numDays` days (inclusive of today). */
export async function computeMovesPerDayLastDays(
  filter: { repertoireId: string | 'all' },
  numDays = 21,
): Promise<DayMoveCount[]> {
  const runs = await listTrainRuns({ repertoireId: filter.repertoireId })
  const byDay = new Map<string, number>()
  for (const r of runs) {
    byDay.set(r.dayKey, (byDay.get(r.dayKey) ?? 0) + r.movesPlayed)
  }
  const out: DayMoveCount[] = []
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (numDays - 1))
  for (let i = 0; i < numDays; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = dayKeyFromTimestamp(d.getTime())
    out.push({ dayKey: key, moves: byDay.get(key) ?? 0 })
  }
  return out
}

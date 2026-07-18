import type { AnimationSpeed, PlaybackSettings } from './buildTypes'

export const PLAYBACK_SETTINGS_STORAGE_KEY = 'chess-trainer:playback-settings:v1'
export const LAST_OPENED_REPERTOIRE_STORAGE_KEY = 'chess-trainer:last-opened-repertoire:v1'
export const PLAYED_PUZZLE_IDS_STORAGE_KEY = 'chess-trainer:puzzle-played-ids:v1'

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  animationSpeed: 'fast',
  replayMoves: true,
  soundOn: false,
}

export const SPEED_DELAY_MS: Record<
  AnimationSpeed,
  { replayStart: number; replayStep: number; autoReply: number; nextLine: number }
> = {
  very_fast: { replayStart: 80, replayStep: 120, autoReply: 120, nextLine: 500 },
  fast: { replayStart: 180, replayStep: 240, autoReply: 250, nextLine: 1000 },
  medium: { replayStart: 280, replayStep: 360, autoReply: 450, nextLine: 1500 },
  slow: { replayStart: 420, replayStep: 520, autoReply: 700, nextLine: 2200 },
}

export function readPlaybackSettings(): PlaybackSettings {
  try {
    const raw = window.localStorage.getItem(PLAYBACK_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_PLAYBACK_SETTINGS
    const parsed = JSON.parse(raw) as Partial<PlaybackSettings> | null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PLAYBACK_SETTINGS
    const speed =
      parsed.animationSpeed === 'very_fast' ||
      parsed.animationSpeed === 'fast' ||
      parsed.animationSpeed === 'medium' ||
      parsed.animationSpeed === 'slow'
        ? parsed.animationSpeed
        : DEFAULT_PLAYBACK_SETTINGS.animationSpeed
    return {
      animationSpeed: speed,
      replayMoves: typeof parsed.replayMoves === 'boolean' ? parsed.replayMoves : DEFAULT_PLAYBACK_SETTINGS.replayMoves,
      soundOn: typeof parsed.soundOn === 'boolean' ? parsed.soundOn : DEFAULT_PLAYBACK_SETTINGS.soundOn,
    }
  } catch {
    return DEFAULT_PLAYBACK_SETTINGS
  }
}

export function persistPlaybackSettings(s: PlaybackSettings) {
  try {
    window.localStorage.setItem(PLAYBACK_SETTINGS_STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore storage errors
  }
}

export function readLastOpenedRepertoireId(): string | null {
  try {
    return window.localStorage.getItem(LAST_OPENED_REPERTOIRE_STORAGE_KEY)
  } catch {
    return null
  }
}

export function persistLastOpenedRepertoireId(id: string): void {
  try {
    window.localStorage.setItem(LAST_OPENED_REPERTOIRE_STORAGE_KEY, id)
  } catch {
    // ignore storage errors
  }
}

export function readPlayedPuzzleIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(PLAYED_PUZZLE_IDS_STORAGE_KEY)
    if (!raw) return new Set<string>()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(parsed.filter((x) => typeof x === 'string' && x.length > 0))
  } catch {
    return new Set<string>()
  }
}

export function persistPlayedPuzzleIds(ids: Set<string>) {
  try {
    const arr = [...ids].slice(-20000)
    window.localStorage.setItem(PLAYED_PUZZLE_IDS_STORAGE_KEY, JSON.stringify(arr))
  } catch {
    // ignore storage errors
  }
}

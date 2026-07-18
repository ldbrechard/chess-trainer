import type { DrawShape } from 'chessground/draw'
import type { Move, Repertoire } from '../../db/schema'

export type Toast = { type: 'info' | 'error'; message: string } | null
export type Mode = 'build' | 'train' | 'puzzle'
export type TrainRunKind = 'full' | 'selection' | 'failed' | 'random' | 'fsrs'
export type View = 'home' | 'session'
export type RepertoireCounts = Record<string, number>
export type RepertoireMastery = Record<string, number>
export type AnnotationTool = 'none' | 'arrow' | 'circle'
export type AnnotationBrush = NonNullable<DrawShape['brush']>
export type MobileBuildTab = 'tree' | 'explorer' | 'train' | 'settings'
export type MobileHomeSideTab = 'white' | 'black' | 'all'
export type AnimationSpeed = 'very_fast' | 'fast' | 'medium' | 'slow'
export type PlaybackSettings = {
  animationSpeed: AnimationSpeed
  replayMoves: boolean
  soundOn: boolean
}

export type Modal =
  | {
      kind: 'trainStart'
      fullCount: number
      selectionCount: number
      hasSelection: boolean
    }
  | {
      kind: 'trainRandomConfig'
      maxCount: number
      hasSelection: boolean
      selectionMaxCount: number
    }
  | {
      kind: 'trainSummary'
      totalPositions: number
      passed: number
      failed: number
      failedPositions: Array<string | null>
    }
  | {
      kind: 'puzzleStart'
      hasSelection: boolean
    }
  | { kind: 'confirmDeleteMove'; move: Move }
  | { kind: 'confirmDeleteRepertoire'; repertoire: Repertoire }
  | null

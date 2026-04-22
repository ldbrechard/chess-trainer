import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Brain,
  Check,
  Circle,
  Download,
  Eye,
  Flame,
  LayoutGrid,
  ListTree,
  Pencil,
  Power,
  Settings,
  Share2,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'

import { Board } from '../../components/Board'
import { EvalBar } from '../../components/EvalBar'
import { UserProfileChrome } from '../../components/UserProfileChrome'
import { computeDests } from '../../chess/computeDests'
import { buildMoveForest, pathToIdSet, pickMainLineChild } from '../../chess/moveTree'
import type { Move, Repertoire, Side } from '../../db/schema'
import {
  addMove,
  createRepertoire,
  deleteMoveSubtree,
  deleteRepertoire,
  getRepertoire,
  listChildrenMoves,
  listAllMoves,
  listRepertoires,
  promoteVariation,
  promoteMoveToMainLine,
  updateMove,
  updateRepertoireMetadata,
  updateRepertoireNotificationSettings,
} from '../../db/repertoireRepo'
import { buildFsrsTrainQueue, encodeParentKey, recordPositionFsrsReview } from '../../db/fsrsRepo'
import { db } from '../../db/schema'
import { dayKeyFromTimestamp, insertTrainRun, touchTrainActivityDay } from '../../db/trainStatsRepo'
import { exportRepertoireToPgn } from '../../lib/pgnImportExport'
import { normalizeToUsefulPuzzleTag } from '../../lib/puzzleOpeningTags'
import { doesAnyPuzzleExistForOpeningTag, fetchPuzzlesByOpeningTags } from '../../lib/puzzleRepo'
import {
  areUciMovesEquivalent,
  openingNameToCanonicalTag,
  playUci,
  preparePuzzle,
  type PuzzleDifficulty,
  type PuzzlePrepared,
  uciToMoveKeys,
  uciFromBoardMove,
} from '../../lib/puzzleUtils'
import type { EngineEval } from '../../lib/stockfishClient'
import { formatEval, StockfishBrowserEngine } from '../../lib/stockfishClient'
import { ImportRepertoireModal } from '../repertoire/ImportRepertoireModal'
import { ShareRepertoireModal } from '../repertoire/ShareRepertoireModal'
import { MoveTreeView, formatMoveWithNag, moveNumberPrefix } from './MoveTreeView'
import openingIslandIcon from '../../assets/icon.png'
import { useDevice } from '../../hooks/useDevice'
import { useI18n } from '../../i18n'
import { OpeningExplorer } from './OpeningExplorer'

type Toast = { type: 'info' | 'error'; message: string } | null
type Mode = 'build' | 'train' | 'puzzle'
type TrainRunKind = 'full' | 'selection' | 'failed' | 'random' | 'fsrs'
type Modal =
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

type View = 'home' | 'session'
type RepertoireCounts = Record<string, number>
type RepertoireMastery = Record<string, number>
type AnnotationTool = 'none' | 'arrow' | 'circle'
type AnnotationBrush = NonNullable<DrawShape['brush']>

const ANNOTATION_BRUSH_CYCLE = ['green', 'red', 'blue'] as const satisfies readonly AnnotationBrush[]
const EMPTY_DESTS = new Map<Key, Key[]>()
const STOCKFISH_VERSION_LABEL = 'Stockfish 16.1'

function sideToTurn(side: Side): 'w' | 'b' {
  return side === 'white' ? 'w' : 'b'
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function formatDurationMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

type AnimationSpeed = 'very_fast' | 'fast' | 'medium' | 'slow'
type PlaybackSettings = {
  animationSpeed: AnimationSpeed
  replayMoves: boolean
  soundOn: boolean
}
type VisualTheme = 'high_contrast' | 'soft_pro'

const PLAYBACK_SETTINGS_STORAGE_KEY = 'chess-trainer:playback-settings:v1'
const VISUAL_THEME_STORAGE_KEY = 'chess-trainer:visual-theme:v1'
const LAST_OPENED_REPERTOIRE_STORAGE_KEY = 'chess-trainer:last-opened-repertoire:v1'
const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = {
  animationSpeed: 'fast',
  replayMoves: true,
  soundOn: false,
}
const DEFAULT_VISUAL_THEME: VisualTheme = 'soft_pro'

const SPEED_DELAY_MS: Record<AnimationSpeed, { replayStart: number; replayStep: number; autoReply: number; nextLine: number }> = {
  very_fast: { replayStart: 80, replayStep: 120, autoReply: 120, nextLine: 500 },
  fast: { replayStart: 180, replayStep: 240, autoReply: 250, nextLine: 1000 },
  medium: { replayStart: 280, replayStep: 360, autoReply: 450, nextLine: 1500 },
  slow: { replayStart: 420, replayStep: 520, autoReply: 700, nextLine: 2200 },
}

function readPlaybackSettings(): PlaybackSettings {
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

function persistPlaybackSettings(s: PlaybackSettings) {
  try {
    window.localStorage.setItem(PLAYBACK_SETTINGS_STORAGE_KEY, JSON.stringify(s))
  } catch {
    // ignore storage errors
  }
}

function readVisualTheme(): VisualTheme {
  try {
    const raw = window.localStorage.getItem(VISUAL_THEME_STORAGE_KEY)
    if (raw === 'high_contrast' || raw === 'soft_pro') return raw
    return DEFAULT_VISUAL_THEME
  } catch {
    return DEFAULT_VISUAL_THEME
  }
}

function persistVisualTheme(theme: VisualTheme) {
  try {
    window.localStorage.setItem(VISUAL_THEME_STORAGE_KEY, theme)
  } catch {
    // ignore storage errors
  }
}

function readLastOpenedRepertoireId(): string | null {
  try {
    return window.localStorage.getItem(LAST_OPENED_REPERTOIRE_STORAGE_KEY)
  } catch {
    return null
  }
}

function persistLastOpenedRepertoireId(id: string): void {
  try {
    window.localStorage.setItem(LAST_OPENED_REPERTOIRE_STORAGE_KEY, id)
  } catch {
    // ignore storage errors
  }
}

const PLAYED_PUZZLE_IDS_STORAGE_KEY = 'chess-trainer:puzzle-played-ids:v1'

function readPlayedPuzzleIds(): Set<string> {
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

function persistPlayedPuzzleIds(ids: Set<string>) {
  try {
    // Keep a bounded history to avoid unbounded storage growth.
    const arr = [...ids].slice(-20000)
    window.localStorage.setItem(PLAYED_PUZZLE_IDS_STORAGE_KEY, JSON.stringify(arr))
  } catch {
    // ignore storage errors
  }
}

/** Chessground must revert the drag if the move is not applied (see Board `after`). */
function rejectBoardMove(): never {
  const e = new Error('BOARD_MOVE_REJECTED')
  e.name = 'BoardMoveRejected'
  throw e
}

function isBoardMoveRejected(e: unknown): boolean {
  return e instanceof Error && e.name === 'BoardMoveRejected'
}

/** Coups attendus pour la couleur répertoire à ce nœud (toutes les réponses ou ligne principale seule). */
function expectedTrainReplies(children: Move[], mainLineOnly: boolean): Move[] {
  if (children.length === 0) return []
  if (mainLineOnly) {
    const main = pickMainLineChild(children)
    return main ? [main] : []
  }
  return children
}

function computeTrainPositionsForRepertoire(side: Side, moves: Move[]): Array<string | null> {
  const byId = new Map<string, Move>()
  for (const m of moves) byId.set(m.id, m)

  const childrenByParent = new Map<string | null, Move[]>()
  for (const m of moves) {
    const key = m.parentId ?? null
    const list = childrenByParent.get(key)
    if (list) list.push(m)
    else childrenByParent.set(key, [m])
  }

  const out: Array<string | null> = []
  for (const parentId of childrenByParent.keys()) {
    const kids = childrenByParent.get(parentId) ?? []
    if (kids.length === 0) continue
    const fen = parentId == null ? new Chess().fen() : byId.get(parentId)?.fen
    if (!fen) continue
    const c = new Chess()
    try {
      c.load(fen)
    } catch {
      continue
    }
    if (c.turn() === sideToTurn(side)) out.push(parentId)
  }
  return out
}

function computeMaxDepthForRepertoire(moves: Move[]): number {
  if (moves.length === 0) return 0
  const byId = new Map<string, Move>()
  for (const move of moves) byId.set(move.id, move)
  const depthById = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depthById.get(id)
    if (cached != null) return cached
    const move = byId.get(id)
    if (!move) return 0
    const depth = move.parentId ? depthOf(move.parentId) + 1 : 1
    depthById.set(id, depth)
    return depth
  }
  let maxDepth = 0
  for (const move of moves) {
    const d = depthOf(move.id)
    if (d > maxDepth) maxDepth = d
  }
  return maxDepth
}

function computeMainLineTerminalFen(moves: Move[]): string {
  if (moves.length === 0) return new Chess().fen()
  const childrenByParent = new Map<string | null, Move[]>()
  for (const m of moves) {
    const key = m.parentId ?? null
    const list = childrenByParent.get(key)
    if (list) list.push(m)
    else childrenByParent.set(key, [m])
  }
  let parentId: string | null = null
  let currentFen = new Chess().fen()
  for (;;) {
    const children = childrenByParent.get(parentId) ?? []
    if (children.length === 0) return currentFen
    const main = pickMainLineChild(children)
    if (!main) return currentFen
    currentFen = main.fen
    parentId = main.id
  }
}

function formatLastTrainLabel(dayKey: string | undefined, t: ReturnType<typeof useI18n>['t']): string {
  if (!dayKey) return t({ en: 'Never', fr: 'Jamais' })
  const [y, m, d] = dayKey.split('-').map(Number)
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayKey
  const trainMs = new Date(y, m - 1, d, 12, 0, 0, 0).getTime()
  const daysAgo = Math.max(0, Math.floor((Date.now() - trainMs) / 86400000))
  if (daysAgo === 0) return t({ en: 'Today', fr: "Aujourd'hui" })
  if (daysAgo === 1) return t({ en: 'Yesterday', fr: 'Hier' })
  return t({ en: '{count} days ago', fr: 'Il y a {count} jours' }, { count: daysAgo })
}

function pvUciToSanLine(fen: string, pvUci: string[] | undefined): string {
  if (!pvUci || pvUci.length === 0) return '—'
  const c = new Chess()
  try {
    c.load(fen)
  } catch {
    return pvUci.join(' ')
  }
  const out: string[] = []
  for (let i = 0; i < pvUci.length; i += 1) {
    const uci = pvUci[i]!
    const from = uci.slice(0, 2)
    const to = uci.slice(2, 4)
    const promotion = uci.length > 4 ? uci[4] : undefined
    const m = c.move({ from, to, promotion: promotion as 'q' | 'r' | 'b' | 'n' | undefined })
    if (!m) break
    if (m.color === 'w') out.push(`${Math.max(1, c.moveNumber() - 1)}. ${m.san}`)
    else out.push(m.san)
  }
  return out.length > 0 ? out.join(' ') : pvUci.join(' ')
}

function lineToPgnMoves(moves: Move[]): string {
  if (moves.length === 0) return '*'
  const tokens: string[] = []
  for (let ply = 0; ply < moves.length; ply += 1) {
    const m = moves[ply]!
    if (ply % 2 === 0) tokens.push(`${Math.floor(ply / 2) + 1}.`)
    tokens.push(m.notation)
  }
  tokens.push('*')
  return tokens.join(' ')
}

type MobileBuildTab = 'tree' | 'board'

export function BuildMode() {
  const { t } = useI18n()
  const device = useDevice()
  const [mobileBuildTab, setMobileBuildTab] = useState<MobileBuildTab>('board')
  const [view, setView] = useState<View>('home')
  const [importOpen, setImportOpen] = useState(false)
  const [createRepertoireOpen, setCreateRepertoireOpen] = useState(false)
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string } | null>(null)
  const [renameTarget, setRenameTarget] = useState<Repertoire | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renameDescriptionDraft, setRenameDescriptionDraft] = useState('')
  const [repertoires, setRepertoires] = useState<Repertoire[]>([])
  const [repertoireCounts, setRepertoireCounts] = useState<RepertoireCounts>({})
  const [repertoireDueCounts, setRepertoireDueCounts] = useState<RepertoireCounts>({})
  const [repertoireMaxDepth, setRepertoireMaxDepth] = useState<RepertoireCounts>({})
  const [repertoireMastery, setRepertoireMastery] = useState<RepertoireMastery>({})
  const [repertoireMainLineFens, setRepertoireMainLineFens] = useState<Record<string, string>>({})
  const [lastOpenedRepertoireId, setLastOpenedRepertoireId] = useState<string | null>(() =>
    readLastOpenedRepertoireId(),
  )
  const [activeRepertoireId, setActiveRepertoireId] = useState<string | null>(null)
  const [activeRepertoire, setActiveRepertoire] = useState<Repertoire | null>(null)

  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null)
  const [path, setPath] = useState<Move[]>([])
  const [children, setChildren] = useState<Move[]>([])
  const [allMoves, setAllMoves] = useState<Move[]>([])

  const [toast, setToast] = useState<Toast>(null)
  const [busy, setBusy] = useState(false)
  const [selectedChildIndex, setSelectedChildIndex] = useState<number>(0)
  const [mode, setMode] = useState<Mode>('build')
  const [, setRevealed] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [playbackSettings, setPlaybackSettings] = useState<PlaybackSettings>(() => readPlaybackSettings())
  const [visualTheme, setVisualTheme] = useState<VisualTheme>(() => readVisualTheme())
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window
  const [flipBoard, setFlipBoard] = useState(false)
  const [showDests, setShowDests] = useState(true)
  const [showBoardAnnotations, setShowBoardAnnotations] = useState(true)
  const [shapesByFen, setShapesByFen] = useState<Record<string, DrawShape[]>>({})
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('none')
  const [annotationBrush, setAnnotationBrush] = useState<AnnotationBrush>('green')
  const [pendingArrowFrom, setPendingArrowFrom] = useState<Key | null>(null)
  const [pendingArrowTo, setPendingArrowTo] = useState<Key | null>(null)
  const arrowDragFromRef = useRef<Key | null>(null)
  const [openingExplorerCollapsed, setOpeningExplorerCollapsed] = useState(false)
  const exploredByParentRef = useRef<Map<string | null, Set<string>>>(new Map())
  /** True while a user drag is being applied — avoids setBusy() + await flushing a Board update with stale FEN. */
  const boardInteractionInFlightRef = useRef(false)
  const [engineBuildOn, setEngineBuildOn] = useState(false)
  const [positionEval, setPositionEval] = useState<EngineEval | null>(null)
  const [positionEvalBusy, setPositionEvalBusy] = useState(false)
  const stockfishRef = useRef<StockfishBrowserEngine | null>(null)

  const stockfishEvaluateFen = useCallback((fen: string) => {
    const eng = stockfishRef.current
    if (!eng) return Promise.reject(new Error('Stockfish inactif'))
    return eng.analyzeFen(fen, { depth: 10, movetimeMs: 300 })
  }, [])
  const [modal, setModal] = useState<Modal>(null)
  const [fsrsQueuePreviewCount, setFsrsQueuePreviewCount] = useState<number | null>(null)

  const [trainRunActive, setTrainRunActive] = useState(false)
  const [trainRunSuspended, setTrainRunSuspended] = useState(false)
  const suspendedResumeNodeIdRef = useRef<string | null>(null)
  const [trainRunKind, setTrainRunKind] = useState<TrainRunKind>('full')
  const [trainScopeRootId, setTrainScopeRootId] = useState<string | null>(null)
  const passedPositionsRef = useRef<Set<string | null>>(new Set())
  const failedPositionsRef = useRef<Set<string | null>>(new Set())
  const [trainRunPositions, setTrainRunPositions] = useState<Array<string | null> | null>(null)
  const [trainRunIndex, setTrainRunIndex] = useState(0)
  const [trainPassed, setTrainPassed] = useState(0)
  const [trainFailed, setTrainFailed] = useState(0)
  const [trainCombo, setTrainCombo] = useState(0)
  const [trainMissPulse, setTrainMissPulse] = useState(false)
  const [hintStep, setHintStep] = useState<0 | 1 | 2>(0)
  const [replayingSequence, setReplayingSequence] = useState(false)
  const [randomCountDraft, setRandomCountDraft] = useState(10)
  const [randomScopeSelected, setRandomScopeSelected] = useState(false)
  const [trainMainLineOnly, setTrainMainLineOnly] = useState(true)
  const [trainFoundAnswerIds, setTrainFoundAnswerIds] = useState<string[]>([])
  const [trainGreyAutoShapes, setTrainGreyAutoShapes] = useState<DrawShape[]>([])
  const [puzzleDifficulty, setPuzzleDifficulty] = useState<PuzzleDifficulty>('medium')
  const [puzzleQueue, setPuzzleQueue] = useState<PuzzlePrepared[]>([])
  const [puzzleIndex, setPuzzleIndex] = useState(0)
  const [puzzleFen, setPuzzleFen] = useState<string | null>(null)
  const [puzzleStep, setPuzzleStep] = useState(0)
  const [puzzleResultsByIndex, setPuzzleResultsByIndex] = useState<Record<number, 'pass' | 'fail'>>({})
  const [puzzleFrontierIndex, setPuzzleFrontierIndex] = useState(0)
  const [puzzleFeedback, setPuzzleFeedback] = useState<'pass' | 'fail' | null>(null)
  const [puzzleOpeningTags, setPuzzleOpeningTags] = useState<string[]>([])
  const [puzzleStartTagsDraft, setPuzzleStartTagsDraft] = useState<string[]>([])
  const [puzzleLoading, setPuzzleLoading] = useState(false)
  const [puzzleShowHint, setPuzzleShowHint] = useState(false)
  const [puzzleStartedAtMs, setPuzzleStartedAtMs] = useState<number | null>(null)
  const [puzzleDurationsMs, setPuzzleDurationsMs] = useState<number[]>([])
  const [playedPuzzleIds, setPlayedPuzzleIds] = useState<Set<string>>(() => readPlayedPuzzleIds())
  const openingNameCacheRef = useRef<Map<string, string | null>>(new Map())
  const usefulTagExistenceCacheRef = useRef<Map<string, boolean>>(new Map())

  const trainMovesPlayedRef = useRef(0)
  const trainSessionNonceRef = useRef(0)
  const trainStatsInsertedForSessionRef = useRef<number | null>(null)

  const currentFen = useMemo(() => {
    if (path.length === 0) return new Chess().fen()
    return path[path.length - 1]!.fen
  }, [path])

  const chess = useMemo(() => {
    const c = new Chess()
    c.load(currentFen)
    return c
  }, [currentFen])

  const turnColor = chess.turn() === 'w' ? 'white' : 'black'
  const dests = useMemo(() => computeDests(chess), [chess])
  const forest = useMemo(() => buildMoveForest(allMoves), [allMoves])
  const movesById = useMemo(() => {
    const map = new Map<string, Move>()
    for (const move of allMoves) {
      map.set(move.id, move)
    }
    return map
  }, [allMoves])
  const isUsersTurn = useMemo(() => {
    if (!activeRepertoire) return false
    return chess.turn() === sideToTurn(activeRepertoire.side)
  }, [activeRepertoire, chess])

  const trainPositions = useMemo(() => {
    if (!activeRepertoire) return []
    return computeTrainPositionsForRepertoire(activeRepertoire.side, allMoves)
  }, [activeRepertoire, allMoves])

  const selectionTrainPositions = useMemo(() => {
    if (currentNodeId == null) return trainPositions

    const isInSubtree = (positionId: string | null) => {
      if (positionId === currentNodeId) return true
      let cursor = positionId
      while (cursor != null) {
        if (cursor === currentNodeId) return true
        cursor = movesById.get(cursor)?.parentId ?? null
      }
      return false
    }

    return trainPositions.filter(isInSubtree)
  }, [currentNodeId, movesById, trainPositions])

  const effectiveTrainPositions = trainRunPositions ?? trainPositions
  const trainTotal = effectiveTrainPositions.length
  const trainRemaining = Math.max(0, trainTotal - trainPassed)
  const expectedTrainRepliesList = useMemo((): Move[] => {
    if (mode !== 'train' || !isUsersTurn) return []
    return expectedTrainReplies(children, trainMainLineOnly)
  }, [children, isUsersTurn, mode, trainMainLineOnly])

  const trainRepliesRemaining = useMemo(() => {
    if (expectedTrainRepliesList.length === 0) return 0
    const found = new Set(trainFoundAnswerIds)
    return expectedTrainRepliesList.filter((m) => !found.has(m.id)).length
  }, [expectedTrainRepliesList, trainFoundAnswerIds])

  const hintMoveKeys = useMemo(() => {
    if (mode !== 'train') return null
    if (!isUsersTurn) return null
    const found = new Set(trainFoundAnswerIds)
    const target = expectedTrainRepliesList.find((m) => !found.has(m.id))
    if (!target) return null

    const c = new Chess()
    try {
      c.load(currentFen)
      const move = c.move(target.notation)
      if (!move) return null
      return { from: move.from as Key, to: move.to as Key }
    } catch {
      return null
    }
  }, [currentFen, expectedTrainRepliesList, isUsersTurn, mode, trainFoundAnswerIds])
  const hintSelectedSquare =
    hintStep === 1 ? hintMoveKeys?.from ?? null : hintStep === 2 ? hintMoveKeys?.to ?? null : null
  const boardOrientation: 'white' | 'black' = flipBoard
    ? activeRepertoire?.side === 'black'
      ? 'white'
      : 'black'
    : activeRepertoire?.side === 'black'
      ? 'black'
      : 'white'
  const boardDests = showDests ? dests : new Map<Key, Key[]>()
  const stockfishPvLine = useMemo(() => pvUciToSanLine(currentFen, positionEval?.pvUci), [currentFen, positionEval?.pvUci])
  const currentShapes = shapesByFen[currentFen] ?? []
  const puzzleChess = useMemo(() => {
    if (!puzzleFen) return null
    const c = new Chess()
    try {
      c.load(puzzleFen)
      return c
    } catch {
      return null
    }
  }, [puzzleFen])
  const puzzleTurnColor = puzzleChess?.turn() === 'w' ? 'white' : 'black'
  const puzzleDests = useMemo(() => {
    if (!puzzleChess) return new Map<Key, Key[]>()
    return computeDests(puzzleChess)
  }, [puzzleChess])
  const activePuzzle = puzzleQueue[puzzleIndex] ?? null
  const puzzleResultEntries = useMemo(
    () =>
      Object.entries(puzzleResultsByIndex)
        .map(([k, result]) => ({ puzzleIndex: Number(k), result }))
        .filter((x) => Number.isFinite(x.puzzleIndex))
        .sort((a, b) => a.puzzleIndex - b.puzzleIndex),
    [puzzleResultsByIndex],
  )
  const speedDelay = SPEED_DELAY_MS[playbackSettings.animationSpeed]
  const puzzleHintShape = useMemo((): DrawShape[] => {
    if (!puzzleShowHint || !activePuzzle) return []
    const next = activePuzzle.solutionUci[puzzleStep]
    if (!next) return []
    const keys = uciToMoveKeys(next)
    if (!keys) return []
    return [{ orig: keys.from, dest: keys.to, brush: 'green' as DrawShape['brush'] }]
  }, [activePuzzle, puzzleShowHint, puzzleStep])
  const puzzleAverageMs = useMemo(() => {
    if (puzzleDurationsMs.length === 0) return 0
    return Math.round(puzzleDurationsMs.reduce((sum, x) => sum + x, 0) / puzzleDurationsMs.length)
  }, [puzzleDurationsMs])
  const puzzleStartPreviewTurnColor = useMemo<'white' | 'black'>(() => {
    try {
      const c = new Chess()
      c.load(currentFen)
      return c.turn() === 'w' ? 'white' : 'black'
    } catch {
      return 'white'
    }
  }, [currentFen])

  const annotationPreviewAutoShapes = useMemo((): DrawShape[] => {
    if (annotationTool !== 'arrow') return []
    if (!pendingArrowFrom || !pendingArrowTo || pendingArrowFrom === pendingArrowTo) return []
    const brush = annotationBrush as DrawShape['brush']
    return [{ orig: pendingArrowFrom, dest: pendingArrowTo, brush }]
  }, [annotationBrush, annotationTool, pendingArrowFrom, pendingArrowTo])

  const isAnnotating = mode === 'build' && annotationTool !== 'none'
  const whiteRepertoires = useMemo(() => repertoires.filter((r) => r.side === 'white'), [repertoires])
  const blackRepertoires = useMemo(() => repertoires.filter((r) => r.side === 'black'), [repertoires])
  const currentFocusRepertoire = useMemo(() => {
    if (repertoires.length === 0) return null
    const byLast = repertoires.find((r) => r.id === lastOpenedRepertoireId)
    if (byLast) return byLast
    const byActive = repertoires.find((r) => r.id === activeRepertoireId)
    if (byActive) return byActive
    return repertoires[0] ?? null
  }, [activeRepertoireId, lastOpenedRepertoireId, repertoires])

  useEffect(() => {
    persistPlaybackSettings(playbackSettings)
  }, [playbackSettings])

  useEffect(() => {
    persistVisualTheme(visualTheme)
  }, [visualTheme])

  useEffect(() => {
    if (!activeRepertoireId) return
    setLastOpenedRepertoireId(activeRepertoireId)
    persistLastOpenedRepertoireId(activeRepertoireId)
  }, [activeRepertoireId])

  const toggleRepertoireNotifications = useCallback(() => {
    if (!activeRepertoireId) return
    const nextEnabled = !(activeRepertoire?.notificationsEnabled === true)
    void (async () => {
      if (nextEnabled && notificationsSupported && Notification.permission === 'default') {
        try {
          await Notification.requestPermission()
        } catch {
          // ignore request failures
        }
      }
      await updateRepertoireNotificationSettings(activeRepertoireId, { notificationsEnabled: nextEnabled })
      const rep = await getRepertoire(activeRepertoireId)
      setActiveRepertoire(rep ?? null)
    })()
  }, [activeRepertoire?.notificationsEnabled, activeRepertoireId, notificationsSupported])

  useEffect(() => {
    if (!notificationsSupported) return
    if (Notification.permission !== 'granted') return

    let cancelled = false

    const runReminderCheck = async () => {
      const today = dayKeyFromTimestamp(Date.now())
      const swReg =
        'serviceWorker' in navigator ? await navigator.serviceWorker.ready.catch(() => null) : null

      const reps = await listRepertoires()
      for (const rep of reps) {
        if (cancelled) return
        if (rep.notificationsEnabled !== true) continue

        const show = async (title: string, body: string, tag: string) => {
          const payload = {
            body,
            tag,
            icon: '/app-icon.png',
            badge: '/app-icon.png',
          }
          if (swReg) await swReg.showNotification(title, payload)
          else new Notification(title, payload)
        }

        const lastTrainDayKey = rep.lastTrainDayKey

        // Daily reminder (once/day/repertoire): mention FSRS queue size to continue streak.
        if (rep.lastDailyReminderDayKey !== today && lastTrainDayKey !== today) {
          const moves = await listAllMoves(rep.id)
          const trainPositions = [...new Set(moves.map((m) => m.parentId ?? null))]
          const fsrsCount = (await buildFsrsTrainQueue(rep.id, trainPositions)).length
          if (fsrsCount > 0) {
            const streak = rep.trainStreak ?? 0
            await show(
              t({ en: 'Keep your streak alive', fr: 'Continue ta série' }),
              t(
                {
                  en: '{title}: {count} FSRS positions due today. Streak: {streak} day(s).',
                  fr: '{title} : {count} positions FSRS à revoir aujourd’hui. Série : {streak} jour(s).',
                },
                { title: rep.title, count: fsrsCount, streak },
              ),
              `daily-streak-${rep.id}-${today}`,
            )
            await updateRepertoireNotificationSettings(rep.id, { lastDailyReminderDayKey: today })
            rep.lastDailyReminderDayKey = today
          }
        }

        // 48h inactivity reminder (once/day/repertoire) when no recent training.
        if (lastTrainDayKey && rep.lastInactivityReminderDayKey !== today && lastTrainDayKey !== today) {
          const [y, mo, da] = lastTrainDayKey.split('-').map(Number)
          const lastTrainApproxMs = new Date(y, mo - 1, da, 12, 0, 0, 0).getTime()
          const elapsedHours = (Date.now() - lastTrainApproxMs) / (1000 * 60 * 60)
          if (elapsedHours >= 48) {
            await show(
              t({ en: '48h without training', fr: '48h sans entraînement' }),
              t(
                {
                  en: '{title}: it has been more than 48 hours since your last training run.',
                  fr: '{title} : plus de 48h depuis ton dernier entraînement.',
                },
                { title: rep.title },
              ),
              `inactivity-48h-${rep.id}-${today}`,
            )
            await updateRepertoireNotificationSettings(rep.id, {
              lastInactivityReminderDayKey: today,
            })
            rep.lastInactivityReminderDayKey = today
          }
        }
      }
    }

    void runReminderCheck()
    const intervalId = window.setInterval(() => {
      void runReminderCheck()
    }, 30 * 60 * 1000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [notificationsSupported, t])

  const refreshRepertoireOverview = useCallback(async () => {
    const reps = await listRepertoires()
    setRepertoires(reps)

    const counts: RepertoireCounts = {}
    const dueCounts: RepertoireCounts = {}
    const maxDepthByRep: RepertoireCounts = {}
    const masteryByRep: RepertoireMastery = {}
    const mainLineFensByRep: Record<string, string> = {}
    await Promise.all(
      reps.map(async (rep) => {
        const moves = await listAllMoves(rep.id)
        counts[rep.id] = moves.length
        maxDepthByRep[rep.id] = computeMaxDepthForRepertoire(moves)
        mainLineFensByRep[rep.id] = computeMainLineTerminalFen(moves)
        const trainable = computeTrainPositionsForRepertoire(rep.side, moves)
        dueCounts[rep.id] = (await buildFsrsTrainQueue(rep.id, trainable)).length
        if (trainable.length === 0) {
          masteryByRep[rep.id] = 0
          return
        }
        const cards = await db.fsrsCards.where('repertoireId').equals(rep.id).toArray()
        const seenKeys = new Set(cards.map((x) => x.parentPositionKey))
        const covered = trainable.reduce((n, pos) => (seenKeys.has(encodeParentKey(pos)) ? n + 1 : n), 0)
        masteryByRep[rep.id] = Math.round((covered / trainable.length) * 100)
      }),
    )
    setRepertoireCounts(counts)
    setRepertoireDueCounts(dueCounts)
    setRepertoireMaxDepth(maxDepthByRep)
    setRepertoireMastery(masteryByRep)
    setRepertoireMainLineFens(mainLineFensByRep)
    return reps
  }, [])

  useEffect(() => {
    ;(async () => {
      const reps = await refreshRepertoireOverview()
      if (!activeRepertoireId && reps[0]?.id) setActiveRepertoireId(reps[0].id)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!activeRepertoireId) {
      setActiveRepertoire(null)
      setCurrentNodeId(null)
      setPath([])
      setChildren([])
      setSelectedChildIndex(0)
      setMode('build')
      setRevealed(null)
      exploredByParentRef.current.clear()
      setModal(null)
      setTrainRunActive(false)
      setTrainRunSuspended(false)
      setTrainRunKind('full')
      setTrainScopeRootId(null)
      passedPositionsRef.current = new Set()
      failedPositionsRef.current = new Set()
      setTrainRunPositions(null)
      setTrainRunIndex(0)
      setTrainPassed(0)
      setTrainFailed(0)
      setHintStep(0)
      setSettingsOpen(false)
      setFlipBoard(false)
      setShowDests(true)
      setShowBoardAnnotations(true)
      setShapesByFen({})
      return
    }

    ;(async () => {
      const rep = await getRepertoire(activeRepertoireId)
      setActiveRepertoire(rep ?? null)
      setCurrentNodeId(null)
      setPath([])
      const kids = await listChildrenMoves({ repertoireId: activeRepertoireId, parentId: null })
      setChildren(kids)
      const moves = await listAllMoves(activeRepertoireId)
      setAllMoves(moves)
      setSelectedChildIndex(0)
      setRevealed(null)
      exploredByParentRef.current.clear()
      setModal(null)
      setTrainRunActive(false)
      setTrainRunSuspended(false)
      setTrainRunKind('full')
      setTrainScopeRootId(null)
      passedPositionsRef.current = new Set()
      failedPositionsRef.current = new Set()
      setTrainRunPositions(null)
      setTrainRunIndex(0)
      setTrainPassed(0)
      setTrainFailed(0)
      setHintStep(0)
      setSettingsOpen(false)
      setFlipBoard(false)
      setShowDests(true)
      setShowBoardAnnotations(false)
    })()
  }, [activeRepertoireId])

  useEffect(() => {
    // Hide annotations by default in Train; keep whatever user had in Build.
    if (mode === 'train') {
      setShowBoardAnnotations(false)
      setToast(null)
    }
  }, [mode])

  useEffect(() => {
    if (!device.isMobile) setMobileBuildTab('board')
  }, [device.isMobile])

  useEffect(() => {
    if (device.isMobile && view === 'session' && mode === 'build') setMobileBuildTab('board')
  }, [activeRepertoireId, device.isMobile, mode, view])

  useEffect(() => {
    if (modal?.kind !== 'trainStart' || !activeRepertoireId) {
      setFsrsQueuePreviewCount(null)
      return
    }
    let cancelled = false
    setFsrsQueuePreviewCount(null)
    void buildFsrsTrainQueue(activeRepertoireId, trainPositions).then((q) => {
      if (!cancelled) setFsrsQueuePreviewCount(q.length)
    })
    return () => {
      cancelled = true
    }
  }, [modal, activeRepertoireId, trainPositions])

  useEffect(() => {
    if (!engineBuildOn || mode !== 'build') {
      stockfishRef.current?.dispose()
      stockfishRef.current = null
      setPositionEval(null)
      setPositionEvalBusy(false)
      return
    }
    stockfishRef.current = new StockfishBrowserEngine()
    return () => {
      stockfishRef.current?.dispose()
      stockfishRef.current = null
    }
  }, [engineBuildOn, mode])

  useEffect(() => {
    if (!engineBuildOn || mode !== 'build') {
      setPositionEval(null)
      setPositionEvalBusy(false)
      return
    }
    const eng = stockfishRef.current
    if (!eng) return
    let cancelled = false
    setPositionEvalBusy(true)
    void eng
      .analyzeFen(currentFen, { depth: 12, movetimeMs: 450 })
      .then((e) => {
        if (!cancelled) setPositionEval(e)
      })
      .catch(() => {
        if (!cancelled) setPositionEval(null)
      })
      .finally(() => {
        if (!cancelled) setPositionEvalBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentFen, engineBuildOn, mode])

  useEffect(() => {
    if (!renameTarget) return
    setRenameDraft(renameTarget.title)
    setRenameDescriptionDraft(renameTarget.description ?? '')
  }, [renameTarget])

  useEffect(() => {
    setHintStep(0)
  }, [children.length, currentFen, mode])

  useEffect(() => {
    if (mode !== 'train') return
    setTrainFoundAnswerIds([])
    setTrainGreyAutoShapes([])
  }, [currentNodeId, isUsersTurn, mode])

  useEffect(() => {
    // Don't keep half-finished arrows when position changes.
    setPendingArrowFrom(null)
    setPendingArrowTo(null)
    arrowDragFromRef.current = null
  }, [annotationTool, currentFen])

  const toggleShape = useCallback((shape: DrawShape) => {
    setShapesByFen((prev) => {
      const existing = prev[currentFen] ?? []
      const same = (a: DrawShape, b: DrawShape) => a.orig === b.orig && a.dest === b.dest && a.brush === b.brush
      const idx = existing.findIndex((s) => same(s, shape))
      const next = idx >= 0 ? existing.filter((_, i) => i !== idx) : [...existing, shape]
      return { ...prev, [currentFen]: next }
    })
  }, [currentFen])

  const onAnnotateStart = useCallback(
    (sq: Key) => {
      if (mode !== 'build') return
      if (annotationTool === 'none') return

      // Ensure shapes are visible while using tools.
      if (!showBoardAnnotations) setShowBoardAnnotations(true)
      if (annotationTool === 'arrow') {
        setPendingArrowTo(null)
        arrowDragFromRef.current = sq
        setPendingArrowFrom(sq)
      }
    },
    [annotationTool, mode, showBoardAnnotations],
  )

  const onAnnotateMove = useCallback(
    (sq: Key | null) => {
      if (mode !== 'build') return
      if (annotationTool !== 'arrow') return
      setPendingArrowTo(sq)
    },
    [annotationTool, mode],
  )

  const onAnnotateEnd = useCallback(
    (sq: Key | null) => {
      if (mode !== 'build') return
      if (annotationTool === 'none') return

      if (!showBoardAnnotations) setShowBoardAnnotations(true)

      setPendingArrowTo(null)

      if (sq === null) {
        if (annotationTool === 'arrow') {
          arrowDragFromRef.current = null
          setPendingArrowFrom(null)
        }
        return
      }

      const brush = annotationBrush as DrawShape['brush']
      if (annotationTool === 'circle') {
        toggleShape({ orig: sq, brush } as DrawShape)
        return
      }

      const from = arrowDragFromRef.current ?? pendingArrowFrom
      arrowDragFromRef.current = null
      setPendingArrowFrom(null)
      if (!from) return
      if (from === sq) return
      toggleShape({ orig: from, dest: sq, brush } as DrawShape)
    },
    [annotationBrush, annotationTool, mode, pendingArrowFrom, showBoardAnnotations, toggleShape],
  )

  useEffect(() => {
    // Keep keyboard selection valid when variants change.
    setSelectedChildIndex((idx) => {
      if (children.length === 0) return 0
      return Math.max(0, Math.min(idx, children.length - 1))
    })
  }, [children.length])

  const refreshChildren = useCallback(async (repertoireId: string, parentId: string | null) => {
    const kids = await listChildrenMoves({ repertoireId, parentId })
    setChildren(kids)
  }, [])

  const refreshAllMoves = useCallback(async (repertoireId: string) => {
    const moves = await listAllMoves(repertoireId)
    setAllMoves(moves)
  }, [])

  const goToRoot = useCallback(async () => {
    if (!activeRepertoireId) return
    setCurrentNodeId(null)
    setPath([])
    setSelectedChildIndex(0)
    setRevealed(null)
    await refreshChildren(activeRepertoireId, null)
  }, [activeRepertoireId, refreshChildren])

  const resetTrainRun = useCallback(() => {
    exploredByParentRef.current.clear()
    setTrainRunSuspended(false)
    setTrainRunKind('full')
    setTrainScopeRootId(null)
    passedPositionsRef.current = new Set()
    failedPositionsRef.current = new Set()
    setTrainPassed(0)
    setTrainFailed(0)
    setTrainRunIndex(0)
    setTrainCombo(0)
    trainMovesPlayedRef.current = 0
    setTrainFoundAnswerIds([])
    setTrainGreyAutoShapes([])
  }, [])

  const replayToPositionId = useCallback(
    async (posId: string | null) => {
      if (!activeRepertoireId) return
      if (posId == null) {
        await goToRoot()
        return
      }
      if (!playbackSettings.replayMoves) {
        const nextPath: Move[] = []
        let cur: Move | undefined = movesById.get(posId)
        while (cur) {
          nextPath.push(cur)
          if (cur.parentId == null) break
          cur = movesById.get(cur.parentId)
        }
        nextPath.reverse()
        setPath(nextPath)
        setCurrentNodeId(posId)
        setSelectedChildIndex(0)
        setRevealed(null)
        await refreshChildren(activeRepertoireId, posId)
        return
      }

      setReplayingSequence(true)
      try {
        const nextPath: Move[] = []
        let cur: Move | undefined = movesById.get(posId)
        while (cur) {
          nextPath.push(cur)
          if (cur.parentId == null) break
          cur = movesById.get(cur.parentId)
        }
        nextPath.reverse()

        setCurrentNodeId(null)
        setPath([])
        setSelectedChildIndex(0)
        setRevealed(null)
        await refreshChildren(activeRepertoireId, null)
        await sleep(speedDelay.replayStart)

        for (let i = 0; i < nextPath.length; i += 1) {
          const partial = nextPath.slice(0, i + 1)
          const current = partial[partial.length - 1]!
          setPath(partial)
          setCurrentNodeId(current.id)
          await sleep(speedDelay.replayStep)
        }

        await refreshChildren(activeRepertoireId, posId)
      } finally {
        setReplayingSequence(false)
      }
    },
    [activeRepertoireId, goToRoot, movesById, playbackSettings.replayMoves, refreshChildren, speedDelay.replayStart, speedDelay.replayStep],
  )

  const suspendTrainRun = useCallback(() => {
    if (!trainRunActive) return
    suspendedResumeNodeIdRef.current = currentNodeId
    setTrainRunSuspended(true)
    setTrainRunActive(false)
    setMode('build')
  }, [trainRunActive, currentNodeId])

  const resumeTrainRun = useCallback(async () => {
    if (!trainRunSuspended) return
    const pos = suspendedResumeNodeIdRef.current
    setTrainRunSuspended(false)
    setTrainRunActive(true)
    setMode('train')
    await replayToPositionId(pos ?? null)
  }, [trainRunSuspended, replayToPositionId])

  const startTrainRun = useCallback(
    async (options?: {
      kind?: TrainRunKind
      positions?: Array<string | null>
      scopeRootId?: string | null
    }) => {
      if (!activeRepertoireId) return
      resetTrainRun()
      const kind = options?.kind ?? 'full'
      const positions = options?.positions
      setTrainRunKind(kind)
      setTrainScopeRootId(options?.scopeRootId ?? null)
      setTrainRunPositions(positions ?? null)
      setTrainRunActive(true)
      setMode('train')
      trainSessionNonceRef.current += 1

      if (positions && positions.length > 0) {
        setTrainRunIndex(0)
        await replayToPositionId(positions[0] ?? null)
      } else {
        await goToRoot()
      }
    },
    [activeRepertoireId, goToRoot, replayToPositionId, resetTrainRun],
  )

  const startRandomTrainRun = useCallback(
    async (opts: { count: number; scopeSelection: boolean }) => {
      const pool =
        opts.scopeSelection && currentNodeId != null ? selectionTrainPositions : trainPositions
      const max = pool.length
      const n = Math.max(0, Math.min(opts.count, max))
      if (n === 0) return

      const copy = [...pool]
      // Fisher–Yates shuffle (in place)
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[copy[i], copy[j]] = [copy[j], copy[i]]
      }
      const picked = copy.slice(0, n)
      await startTrainRun({
        kind: 'random',
        positions: picked,
        scopeRootId: opts.scopeSelection ? currentNodeId : null,
      })
    },
    [currentNodeId, selectionTrainPositions, startTrainRun, trainPositions],
  )

  const loadOpeningNameForFen = useCallback(async (fen: string): Promise<string | null> => {
    const cached = openingNameCacheRef.current.get(fen)
    if (cached !== undefined) return cached

    const token = (import.meta.env.VITE_LICHESS_TOKEN as string | undefined | null)?.trim() ?? ''
    if (!token) {
      openingNameCacheRef.current.set(fen, null)
      return null
    }

    try {
      const url = new URL('https://explorer.lichess.ovh/lichess')
      url.searchParams.set('fen', fen)
      url.searchParams.set('variant', 'chess')
      url.searchParams.set('moves', '0')
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      })
      if (!res.ok) {
        openingNameCacheRef.current.set(fen, null)
        return null
      }
      const json = (await res.json()) as { opening?: { name?: string } | null }
      const name = json.opening?.name?.trim() ?? null
      openingNameCacheRef.current.set(fen, name)
      return name
    } catch {
      openingNameCacheRef.current.set(fen, null)
      return null
    }
  }, [])

  const resolveUsefulPuzzleTag = useCallback(async (canonicalTag: string): Promise<string | null> => {
    const direct = normalizeToUsefulPuzzleTag(canonicalTag)
    if (direct) return direct

    let cur = canonicalTag.trim()
    while (cur.length > 0) {
      const cached = usefulTagExistenceCacheRef.current.get(cur)
      if (cached === true) return cur
      if (cached === undefined) {
        const exists = await doesAnyPuzzleExistForOpeningTag(cur)
        usefulTagExistenceCacheRef.current.set(cur, exists)
        if (exists) return cur
      }
      const i = cur.lastIndexOf('_')
      if (i === -1) break
      cur = cur.slice(0, i)
    }
    return null
  }, [])

  const openingTagsForSelectedVariant = useCallback(async (): Promise<string[]> => {
    const byId = new Map<string, Move>()
    const childrenByParent = new Map<string | null, Move[]>()
    for (const m of allMoves) {
      byId.set(m.id, m)
      const k = m.parentId ?? null
      const list = childrenByParent.get(k)
      if (list) list.push(m)
      else childrenByParent.set(k, [m])
    }

    const fenForPosition = (positionId: string | null): string | null => {
      if (positionId == null) return new Chess().fen()
      return byId.get(positionId)?.fen ?? null
    }
    const parentPositionId = (positionId: string | null): string | null => {
      if (positionId == null) return null
      return byId.get(positionId)?.parentId ?? null
    }

    const openingTagForPosition = async (positionId: string | null): Promise<string | null> => {
      const fen = fenForPosition(positionId)
      if (!fen) return null
      const name = await loadOpeningNameForFen(fen)
      if (!name) return null
      const canonical = openingNameToCanonicalTag(name)
      if (!canonical) return null
      return resolveUsefulPuzzleTag(canonical)
    }

    const selectedPositionId = currentNodeId ?? null
    const selectedTag = await openingTagForPosition(selectedPositionId)

    // 1) No direct opening tag at current position -> walk up until first known tag.
    if (!selectedTag) {
      let cursor = parentPositionId(selectedPositionId)
      while (cursor !== null) {
        const t = await openingTagForPosition(cursor)
        if (t) return [t]
        cursor = parentPositionId(cursor)
      }
      const rootTag = await openingTagForPosition(null)
      return rootTag ? [rootTag] : []
    }

    // 2) Current position has an opening tag -> descend each sub-variation and keep all useful tags encountered.
    const out = new Set<string>()
    const maxVisited = 120
    let visited = 0

    out.add(selectedTag)
    const walk = async (positionId: string | null) => {
      if (visited >= maxVisited) return
      visited += 1
      const kids = childrenByParent.get(positionId) ?? []
      if (kids.length === 0) return

      await Promise.all(
        kids.map(async (k) => {
          const tag = await openingTagForPosition(k.id)
          // Branch stops when there is no longer a known opening tag.
          if (!tag) return
          out.add(tag)
          await walk(k.id)
        }),
      )
    }

    await walk(selectedPositionId)
    return [...out]
  }, [allMoves, currentNodeId, loadOpeningNameForFen, resolveUsefulPuzzleTag])

  const activatePuzzleAtIndex = useCallback(
    (index: number, queueArg?: PuzzlePrepared[]) => {
      const queue = queueArg ?? puzzleQueue
      const p = queue[index]
      if (!p) {
        setPuzzleFen(null)
        return false
      }
      setPuzzleIndex(index)
      setPuzzleFen(p.presentedFen)
      setPuzzleStep(0)
      setPuzzleFeedback(null)
      setPuzzleShowHint(false)
      setPuzzleStartedAtMs(Date.now())
      return true
    },
    [puzzleQueue],
  )

  const loadPuzzleQueue = useCallback(
    async (options: { openingTags: string[]; difficulty?: PuzzleDifficulty }) => {
      const difficulty = options.difficulty ?? puzzleDifficulty
      if (options.openingTags.length === 0) {
        setToast({ type: 'info', message: t({ en: 'No usable opening found for puzzles.', fr: 'Aucune ouverture exploitable pour les puzzles.' }) })
        return
      }
      setPuzzleLoading(true)
      try {
        const rows = await fetchPuzzlesByOpeningTags({
          openingTags: options.openingTags,
          difficulty,
          perTagLimit: 50,
          totalLimit: 32,
        })
        const sideToPlay = activeRepertoire?.side === 'white' ? 'w' : 'b'
        const allPrepared = rows
          .map((r) => preparePuzzle(r))
          .filter(Boolean)
          .filter((p) => p!.playerTurn === sideToPlay) as PuzzlePrepared[]
        const unseenPrepared = allPrepared.filter((p) => !playedPuzzleIds.has(p.id))
        const prepared = unseenPrepared.length > 0 ? unseenPrepared : allPrepared
        if (prepared.length === 0) {
          setToast({ type: 'info', message: t({ en: 'No puzzle found for these criteria.', fr: 'Aucun puzzle trouvé pour ces critères.' }) })
          return
        }
        setPuzzleQueue(prepared)
        setPuzzleResultsByIndex({})
        setPuzzleFrontierIndex(0)
        setPuzzleDurationsMs([])
        setPuzzleOpeningTags(options.openingTags)
        setMode('puzzle')
        setModal(null)
        activatePuzzleAtIndex(0, prepared)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setToast({
          type: 'error',
          message: t(
            {
              en: 'Unable to load puzzles ({msg}). Check RLS/columns for puzzles_v2.',
              fr: 'Impossible de charger les puzzles ({msg}). Vérifie RLS/colonnes de puzzles_v2.',
            },
            { msg },
          ),
        })
      } finally {
        setPuzzleLoading(false)
      }
    },
    [activatePuzzleAtIndex, activeRepertoire?.side, playedPuzzleIds, puzzleDifficulty],
  )

  const markPuzzleAsPlayed = useCallback((puzzleId: string) => {
    setPlayedPuzzleIds((prev) => {
      if (prev.has(puzzleId)) return prev
      const next = new Set(prev)
      next.add(puzzleId)
      persistPlayedPuzzleIds(next)
      return next
    })
  }, [])

  const setPuzzleResultSticky = useCallback((index: number, result: 'pass' | 'fail') => {
    setPuzzleResultsByIndex((prev) => {
      const existing = prev[index]
      if (existing === 'fail') return prev
      if (existing === result) return prev
      return { ...prev, [index]: result }
    })
  }, [])

  const advanceToNextPuzzle = useCallback(
    (result: 'pass' | 'fail') => {
      if (activePuzzle) markPuzzleAsPlayed(activePuzzle.id)
      setPuzzleResultSticky(puzzleIndex, result)

      const now = Date.now()
      if (puzzleStartedAtMs != null) {
        setPuzzleDurationsMs((prev) => [...prev, Math.max(0, now - puzzleStartedAtMs)])
      }

      const nextFrontier = Math.max(puzzleFrontierIndex, puzzleIndex + 1)
      setPuzzleFrontierIndex(nextFrontier)
      const targetIndex = puzzleIndex < puzzleFrontierIndex ? puzzleFrontierIndex : puzzleIndex + 1

      window.setTimeout(() => {
        if (!activatePuzzleAtIndex(targetIndex)) {
          setToast({ type: 'info', message: t({ en: 'Puzzle session complete.', fr: 'Session puzzles terminée.' }) })
          setMode('build')
        }
      }, 450)
    },
    [
      activePuzzle,
      activatePuzzleAtIndex,
      markPuzzleAsPlayed,
      puzzleFrontierIndex,
      puzzleIndex,
      puzzleStartedAtMs,
      setPuzzleResultSticky,
    ],
  )

  const onBoardMovePuzzle = useCallback(
    async (from: Key, to: Key) => {
      if (!activePuzzle || !puzzleFen) rejectBoardMove()
      if (busy || boardInteractionInFlightRef.current) rejectBoardMove()
      boardInteractionInFlightRef.current = true
      try {
        if (puzzleShowHint) setPuzzleShowHint(false)
        const c = new Chess()
        c.load(puzzleFen)

        const move = c.move({ from, to, promotion: 'q' })
        if (!move) rejectBoardMove()

        const expected = activePuzzle.solutionUci[puzzleStep]
        if (!expected) rejectBoardMove()
        const attempted = uciFromBoardMove(from, to, move.promotion)
        if (!areUciMovesEquivalent(expected, attempted)) {
          if (activePuzzle) markPuzzleAsPlayed(activePuzzle.id)
          setPuzzleResultSticky(puzzleIndex, 'fail')
          setPuzzleFeedback('fail')
          window.setTimeout(() => setPuzzleFeedback(null), 800)
          rejectBoardMove()
        }

        setPuzzleFen(c.fen())
        let nextStep = puzzleStep + 1
        if (nextStep >= activePuzzle.solutionUci.length) {
          setPuzzleFeedback('pass')
          advanceToNextPuzzle('pass')
          return
        }

        // Play engine/opponent response from puzzle line automatically.
        const reply = activePuzzle.solutionUci[nextStep]
        if (!reply) return
        const replied = playUci(c, reply)
        if (replied) {
          setPuzzleFen(c.fen())
          nextStep += 1
          setPuzzleStep(nextStep)
          if (nextStep >= activePuzzle.solutionUci.length) {
            setPuzzleFeedback('pass')
            advanceToNextPuzzle('pass')
          }
          return
        }
        setPuzzleStep(nextStep)
      } finally {
        boardInteractionInFlightRef.current = false
      }
    },
    [
      activePuzzle,
      advanceToNextPuzzle,
      busy,
      markPuzzleAsPlayed,
      puzzleFen,
      puzzleIndex,
      puzzleShowHint,
      puzzleStep,
      setPuzzleResultSticky,
    ],
  )

  const showPuzzleSolution = useCallback(() => {
    if (!activePuzzle) return
    markPuzzleAsPlayed(activePuzzle.id)
    setPuzzleResultSticky(puzzleIndex, 'fail')
    setPuzzleShowHint(true)
  }, [activePuzzle, markPuzzleAsPlayed, puzzleIndex, setPuzzleResultSticky])

  const skipPuzzle = useCallback(() => {
    if (!activePuzzle) return
    advanceToNextPuzzle('fail')
  }, [activePuzzle, advanceToNextPuzzle])

  const jumpToPuzzleFromHistory = useCallback(
    (targetIndex: number) => {
      if (targetIndex < 0 || targetIndex >= puzzleQueue.length) return
      activatePuzzleAtIndex(targetIndex)
    },
    [activatePuzzleAtIndex, puzzleQueue.length],
  )

  const reloadPuzzleQueueForDifficulty = useCallback(
    (difficulty: PuzzleDifficulty) => {
      setPuzzleDifficulty(difficulty)
      if (puzzleOpeningTags.length === 0) return
      void loadPuzzleQueue({ openingTags: puzzleOpeningTags, difficulty })
    },
    [loadPuzzleQueue, puzzleOpeningTags],
  )

  useEffect(() => {
    if (modal?.kind !== 'puzzleStart') return
    let cancelled = false
    setPuzzleStartTagsDraft([])
    setPuzzleLoading(true)

    void (async () => {
      try {
        const tags = await openingTagsForSelectedVariant()
        if (cancelled) return
        setPuzzleStartTagsDraft(tags)
      } finally {
        if (!cancelled) setPuzzleLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [modal, openingTagsForSelectedVariant])

  const markExplored = useCallback((parentId: string | null, childId: string | undefined) => {
    if (childId == null) return
    const m = exploredByParentRef.current
    const set = m.get(parentId) ?? new Set<string>()
    set.add(childId)
    m.set(parentId, set)
  }, [])

  const truncatePathToNodeId = useCallback(
    (nodeId: string | null) => {
      if (nodeId == null) return []
      const idx = path.findIndex((m) => m.id === nodeId)
      if (idx === -1) return []
      return path.slice(0, idx + 1)
    },
    [path],
  )

  const backtrackToNextUnexplored = useCallback(async () => {
    if (!activeRepertoireId) return
    if (path.length === 0) return

    setBusy(true)
    setToast(null)
    setRevealed(null)
    setHintStep(0)
    try {
      // Walk from the end, looking for a parent with remaining unexplored children.
      for (let i = path.length - 1; i >= 0; i--) {
        const currentMove = path[i]!
        if (trainRunKind === 'selection' && currentMove.id === trainScopeRootId) break
        const parentId = currentMove.parentId ?? null
        markExplored(parentId, currentMove.id)

        const siblings = await listChildrenMoves({ repertoireId: activeRepertoireId, parentId })
        const explored = exploredByParentRef.current.get(parentId) ?? new Set<string>()
        const remaining = siblings.filter((m) => !explored.has(m.id))

        if (remaining.length > 0) {
          // Jump back to that parent position, continue from the next variation.
          await replayToPositionId(parentId)
          return
        }
      }

      // Fully explored: reset and restart from root (fresh tour).
      exploredByParentRef.current.clear()
      await goToRoot()
    } finally {
      setBusy(false)
    }
  }, [
    activeRepertoireId,
    goToRoot,
    markExplored,
    path,
    replayToPositionId,
    trainRunKind,
    trainScopeRootId,
  ])

  const goBack = useCallback(async () => {
    if (!activeRepertoireId) return
    if (path.length === 0) return
    const nextPath = path.slice(0, -1)
    setPath(nextPath)
    const nextNodeId = nextPath.length ? nextPath[nextPath.length - 1]!.id : null
    setCurrentNodeId(nextNodeId)
    setSelectedChildIndex(0)
    setRevealed(null)
    await refreshChildren(activeRepertoireId, nextNodeId)
  }, [activeRepertoireId, path, refreshChildren])

  const goToEnd = useCallback(async () => {
    if (!activeRepertoireId) return
    let cursorId = currentNodeId
    let guard = 0
    while (guard < 256) {
      guard += 1
      const kids = await listChildrenMoves({ repertoireId: activeRepertoireId, parentId: cursorId })
      if (!kids.length) break
      const main = pickMainLineChild(kids)
      const target = main ?? kids[0]
      if (!target) break
      cursorId = target.id
    }
    await replayToPositionId(cursorId ?? null)
  }, [activeRepertoireId, currentNodeId, replayToPositionId])

  const selectVariant = useCallback(async (move: Move) => {
    if (!activeRepertoireId) return
    const nextPath: Move[] = []
    let cursor: Move | undefined = move
    while (cursor) {
      nextPath.push(cursor)
      if (cursor.parentId == null) break
      cursor = movesById.get(cursor.parentId)
    }
    nextPath.reverse()
    setPath(nextPath)
    setCurrentNodeId(move.id)
    setSelectedChildIndex(0)
    setRevealed(null)
    await refreshChildren(activeRepertoireId, move.id)
  }, [activeRepertoireId, movesById, refreshChildren])

  const goForward = useCallback(async () => {
    if (!children.length) return
    const main = pickMainLineChild(children)
    const target = main ?? children[0]
    if (!target) return
    await selectVariant(target)
  }, [children, selectVariant])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (mode !== 'build') return
      if (!activeRepertoireId) return
      if (busy || boardInteractionInFlightRef.current) return

      const target = e.target as HTMLElement | null
      const tag = target?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (target?.isContentEditable) return

      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        void goBack()
        return
      }
      if (e.key === 'ArrowUp') {
        if (children.length === 0) return
        e.preventDefault()
        setSelectedChildIndex((i) => (i - 1 + children.length) % children.length)
        return
      }
      if (e.key === 'ArrowDown') {
        if (children.length === 0) return
        e.preventDefault()
        setSelectedChildIndex((i) => (i + 1) % children.length)
        return
      }
      if (e.key === 'Enter') {
        if (children.length === 0) return
        e.preventDefault()
        const move = children[selectedChildIndex]
        if (move) void selectVariant(move)
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeRepertoireId, busy, children, goBack, mode, selectVariant, selectedChildIndex])

  const applyBuildMove = async (from: Key, to: Key, promotion?: string) => {
    if (!activeRepertoireId || !activeRepertoire) rejectBoardMove()
    if (busy || boardInteractionInFlightRef.current) rejectBoardMove()
    boardInteractionInFlightRef.current = true

    setToast(null)
    setRevealed(null)
    setHintStep(0)
    try {
      const c = new Chess()
      c.load(currentFen)

      const move = c.move({ from, to, promotion: promotion ?? 'q' })
      if (!move) rejectBoardMove()

      const notation = move.san
      const nextFen = c.fen()

      const parentId = currentNodeId
      const existingChildren = await listChildrenMoves({
        repertoireId: activeRepertoireId,
        parentId,
      })

      const existingSame = existingChildren.find((m) => m.notation === notation)
      if (existingSame) {
        await selectVariant(existingSame)
        return
      }

      const isFirstChildAtParent = existingChildren.length === 0

      const id = await addMove({
        repertoireId: activeRepertoireId,
        parentId,
        fen: nextFen,
        notation,
        comment: '',
        eval: undefined,
        isMainLine: isFirstChildAtParent ? true : undefined,
      })

      const newMove: Move = {
        id,
        repertoireId: activeRepertoireId,
        parentId,
        fen: nextFen,
        notation,
        comment: '',
        isMainLine: isFirstChildAtParent ? true : undefined,
      }

      await selectVariant(newMove)
      setBusy(true)
      await refreshChildren(activeRepertoireId, id)
      await refreshAllMoves(activeRepertoireId)
      await refreshRepertoireOverview()
    } catch (e) {
      if (isBoardMoveRejected(e)) throw e
      setToast({ type: 'error', message: t({ en: 'Error while saving move.', fr: 'Erreur lors de la sauvegarde du coup.' }) })
      rejectBoardMove()
    } finally {
      boardInteractionInFlightRef.current = false
      setBusy(false)
    }
  }

  const onBoardMoveBuild = async (from: Key, to: Key) => {
    await applyBuildMove(from, to, 'q')
  }

  const onPlayExplorerMove = useCallback(
    async (uci: string) => {
      const s = uci.trim()
      if (s.length < 4) return
      const from = s.slice(0, 2) as Key
      const to = s.slice(2, 4) as Key
      const promotion = s.length >= 5 ? s.slice(4, 5) : undefined
      await applyBuildMove(from, to, promotion)
    },
    [applyBuildMove],
  )

  const onBoardMoveTrain = async (from: Key, to: Key) => {
    if (!activeRepertoireId || !activeRepertoire) rejectBoardMove()
    if (busy || boardInteractionInFlightRef.current) rejectBoardMove()
    if (!isUsersTurn) rejectBoardMove()
    boardInteractionInFlightRef.current = true

    setRevealed(null)
    try {
      const c = new Chess()
      c.load(currentFen)

      const move = c.move({ from, to, promotion: 'q' })
      if (!move) rejectBoardMove()

      trainMovesPlayedRef.current += 1
      if (trainRunActive) void touchTrainActivityDay()

      const notation = move.san
      const parentId = currentNodeId
      const expected = expectedTrainReplies(children, trainMainLineOnly)

      const match = expected.find((m) => m.notation === notation && !trainFoundAnswerIds.includes(m.id))
      if (!match) {
        setTrainFoundAnswerIds([])
        setTrainGreyAutoShapes([])
        setTrainMissPulse(true)
        window.setTimeout(() => setTrainMissPulse(false), 450)
        setTrainCombo(0)
        if (trainRunActive) {
          const posKey = parentId ?? null
          if (!failedPositionsRef.current.has(posKey)) {
            failedPositionsRef.current.add(posKey)
            setTrainFailed((n) => n + 1)
            if (trainRunKind === 'fsrs' && activeRepertoireId) {
              void recordPositionFsrsReview(activeRepertoireId, posKey, 'again')
            }
          }
        }

        if (trainRunActive && (trainRunKind === 'random' || trainRunKind === 'fsrs') && trainRunPositions) {
          const nextIdx = trainRunIndex + 1
          setTrainRunIndex(nextIdx)
          const nextPos = trainRunPositions[nextIdx]
          if (nextPos !== undefined) {
            await replayToPositionId(nextPos)
            return
          }
        }
        rejectBoardMove()
      }

      const nextFound = [...trainFoundAnswerIds, match.id]
      const allFound = expected.length > 0 && expected.every((m) => nextFound.includes(m.id))

      const greyBrush = 'paleGrey' as DrawShape['brush']
      setTrainGreyAutoShapes((prev) => [
        ...prev,
        { orig: move.from as Key, dest: move.to as Key, brush: greyBrush },
      ])
      setTrainFoundAnswerIds(nextFound)

      if (!allFound) {
        rejectBoardMove()
      }

      const advance = pickMainLineChild(children)
      if (!advance) rejectBoardMove()

      await selectVariant(advance)
      setBusy(true)
      markExplored(parentId ?? null, advance.id)
      setTrainCombo((x) => x + 1)
      if (trainRunActive) {
        const posKey = parentId ?? null
        if (!passedPositionsRef.current.has(posKey)) {
          passedPositionsRef.current.add(posKey)
          setTrainPassed((n) => n + 1)
          if (trainRunKind === 'fsrs' && activeRepertoireId) {
            void recordPositionFsrsReview(activeRepertoireId, posKey, 'good')
          }
        }
      }

      if (
        trainRunActive &&
        (trainRunKind === 'failed' || trainRunKind === 'random' || trainRunKind === 'fsrs') &&
        trainRunPositions
      ) {
        const nextIdx = trainRunIndex + 1
        setTrainRunIndex(nextIdx)
        const nextPos = trainRunPositions[nextIdx]
        if (nextPos !== undefined) {
          await replayToPositionId(nextPos)
        }
      }
    } catch (e) {
      if (isBoardMoveRejected(e)) throw e
      rejectBoardMove()
    } finally {
      boardInteractionInFlightRef.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    // Auto-play opponent moves in Train mode.
    if (mode !== 'train') return
    if (!activeRepertoireId || !activeRepertoire) return
    if (busy || boardInteractionInFlightRef.current) return
    if (isUsersTurn) return
    if (trainRunKind === 'failed') return

    if (children.length === 0) return

    const explored = exploredByParentRef.current.get(currentNodeId ?? null) ?? new Set<string>()
    const unexplored = children.filter((m) => !explored.has(m.id))
    const pool = unexplored.length > 0 ? unexplored : children
    const opponentMove = pool[Math.floor(Math.random() * pool.length)]
    if (!opponentMove) return

    const t = window.setTimeout(() => {
      void (async () => {
        setBusy(true)
        setToast(null)
        setRevealed(null)
        try {
          await selectVariant(opponentMove)
          markExplored(currentNodeId ?? null, opponentMove.id)
        } finally {
          setBusy(false)
        }
      })()
    }, speedDelay.autoReply)

    return () => window.clearTimeout(t)
  }, [
    activeRepertoire,
    activeRepertoireId,
    busy,
    children,
    currentNodeId,
    isUsersTurn,
    markExplored,
    mode,
    selectVariant,
    speedDelay.autoReply,
    trainRunKind,
  ])

  useEffect(() => {
    // When a line is completed in Train, continue with another line.
    if (mode !== 'train') return
    if (!activeRepertoireId || !activeRepertoire) return
    if (busy || boardInteractionInFlightRef.current) return
    if (trainRunKind === 'failed') return

    // Leaf reached: no more moves from this node.
    if (children.length !== 0) return
    // If repertoire is empty, don't loop.
    if (currentNodeId == null && path.length === 0) return

    const t = window.setTimeout(() => {
      void backtrackToNextUnexplored()
    }, speedDelay.nextLine)
    return () => window.clearTimeout(t)
  }, [
    activeRepertoire,
    activeRepertoireId,
    backtrackToNextUnexplored,
    busy,
    children.length,
    currentNodeId,
    mode,
    path.length,
    speedDelay.nextLine,
    trainRunKind,
  ])

  useEffect(() => {
    if (!trainRunActive) return
    if (trainTotal === 0) return
    if (trainPassed !== trainTotal) return
    if (!activeRepertoireId) return

    const sid = trainSessionNonceRef.current
    if (trainStatsInsertedForSessionRef.current === sid) return
    trainStatsInsertedForSessionRef.current = sid

    const passed = trainPassed
    const failed = trainFailed
    const repId = activeRepertoireId
    const kind = trainRunKind
    const scopeRoot = trainScopeRootId
    const total = trainTotal
    const movesPlayed = trainMovesPlayedRef.current

    void insertTrainRun({
      repertoireId: repId,
      kind,
      scopeRootMoveId: scopeRoot,
      totalPositions: total,
      passed,
      failed,
      movesPlayed,
    }).catch(() => {
      /* ignore persistence errors */
    })

    setTrainRunSuspended(false)
    setTrainRunActive(false)
    setMode('build')
    setHintStep(0)
    setModal({
      kind: 'trainSummary',
      totalPositions: trainTotal,
      passed,
      failed,
      failedPositions: [...failedPositionsRef.current],
    })
  }, [
    activeRepertoireId,
    trainFailed,
    trainPassed,
    trainRunActive,
    trainRunKind,
    trainScopeRootId,
    trainTotal,
  ])

  const handleCreate = async (title: string, side: Side, description?: string): Promise<boolean> => {
    setBusy(true)
    setToast(null)
    try {
      const id = await createRepertoire({ title, side, description })
      await refreshRepertoireOverview()
      setActiveRepertoireId(id)
      setMode('build')
      return true
    } catch {
      setToast({ type: 'error', message: t({ en: 'Unable to create repertoire.', fr: 'Impossible de créer le répertoire.' }) })
      return false
    } finally {
      setBusy(false)
    }
  }

  const handleExportPgn = useCallback(async (repertoireId: string) => {
    const rep = await getRepertoire(repertoireId)
    if (!rep) return
    const moves = await listAllMoves(repertoireId)
    const pgn = exportRepertoireToPgn(rep, moves)
    const safe = rep.title.replace(/[^a-zA-Z0-9\-_ ]+/g, '_').trim().slice(0, 80) || 'repertoire'
    const blob = new Blob([pgn], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.pgn`
    a.click()
    URL.revokeObjectURL(url)
  }, [])

  const onPromoteVariant = useCallback(
    async (move: Move) => {
      if (!activeRepertoireId) return
      if (!move.id) return
      setBusy(true)
      setToast(null)
      try {
        await promoteVariation(move.id)
        await refreshAllMoves(activeRepertoireId)
        await refreshChildren(activeRepertoireId, move.parentId ?? null)
        await refreshRepertoireOverview()
      } catch {
        setToast({ type: 'error', message: t({ en: 'Unable to promote this variation.', fr: 'Impossible de promouvoir cette variante.' }) })
      } finally {
        setBusy(false)
      }
    },
    [activeRepertoireId, refreshAllMoves, refreshChildren, refreshRepertoireOverview, t],
  )

  const onMakeMainLine = useCallback(
    async (move: Move) => {
      if (!activeRepertoireId) return
      if (!move.id) return
      setBusy(true)
      setToast(null)
      try {
        await promoteMoveToMainLine(move.id)
        await refreshAllMoves(activeRepertoireId)
        await refreshChildren(activeRepertoireId, move.parentId ?? null)
        await refreshRepertoireOverview()
      } catch {
        setToast({ type: 'error', message: t({ en: 'Unable to set main line.', fr: 'Impossible de définir la ligne principale.' }) })
      } finally {
        setBusy(false)
      }
    },
    [activeRepertoireId, refreshAllMoves, refreshChildren, refreshRepertoireOverview, t],
  )

  const onCopyVariantPgn = useCallback(
    async (move: Move) => {
      const byId = movesById
      const pathFromRoot: Move[] = []
      let cursor: Move | undefined = move
      while (cursor) {
        pathFromRoot.push(cursor)
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
      }
      pathFromRoot.reverse()

      const childrenByParent = new Map<string | null, Move[]>()
      for (const m of allMoves) {
        const k = m.parentId ?? null
        const list = childrenByParent.get(k)
        if (list) list.push(m)
        else childrenByParent.set(k, [m])
      }

      const continuation: Move[] = []
      let parentId: string | null = move.id
      while (parentId) {
        const children = childrenByParent.get(parentId) ?? []
        const main = pickMainLineChild(children)
        if (!main) break
        continuation.push(main)
        parentId = main.id
      }
      const line = [...pathFromRoot, ...continuation]
      const pgn = lineToPgnMoves(line)
      try {
        await navigator.clipboard.writeText(pgn)
        setToast({ type: 'info', message: t({ en: 'Variation PGN copied.', fr: 'PGN de la variante copié.' }) })
      } catch {
        setToast({ type: 'error', message: t({ en: 'Unable to copy variation PGN.', fr: 'Impossible de copier le PGN de la variante.' }) })
      }
    },
    [allMoves, movesById, t],
  )

  const onDeleteMove = useCallback(
    async (move: Move) => {
      if (!activeRepertoireId) return
      if (!move.id) return
      setModal({ kind: 'confirmDeleteMove', move })
      return

    },
    [activeRepertoireId],
  )

  const selectedMove = useMemo(() => {
    if (currentNodeId == null) return null
    return movesById.get(currentNodeId) ?? null
  }, [currentNodeId, movesById])

  const [moveNagDraft, setMoveNagDraft] = useState('')
  const [moveCommentDraft, setMoveCommentDraft] = useState('')

  const formatNagForInline = useCallback((raw: string | undefined | null) => {
    const s = (raw ?? '').trim()
    if (!s) return ''
    const tokens = s
      .split(/\s+/)
      .map((t) => {
        const tt = t.trim()
        if (!tt) return ''
        if (tt.startsWith('$')) {
          const n = Number(tt.slice(1))
          if (!Number.isFinite(n)) return tt
          switch (n) {
            case 1:
              return '!'
            case 2:
              return '?'
            case 3:
              return '!!'
            case 4:
              return '??'
            case 5:
              return '!?'
            case 6:
              return '?!'
            case 10:
              return '='
            case 13:
              return '∞'
            case 14:
              return '+='
            case 15:
              return '=+'
            case 16:
              return '+-'
            case 17:
              return '-+'
            default:
              return tt
          }
        }
        return tt
      })
      .filter(Boolean)

    if (tokens.length === 0) return ''
    const glued = tokens.join('')
    return /^(?:!|\?|!!|\?\?|!\?|\?!)+$/.test(glued) ? glued : ` ${glued}`
  }, [])

  useEffect(() => {
    if (!selectedMove) {
      setMoveNagDraft('')
      setMoveCommentDraft('')
      return
    }
    setMoveNagDraft(selectedMove.nag ?? '')
    setMoveCommentDraft(selectedMove.comment ?? '')
  }, [selectedMove])

  const saveMoveMeta = useCallback(async () => {
    if (!activeRepertoireId) return
    if (!selectedMove?.id) return
    setToast(null)
    try {
      await updateMove(selectedMove.id, {
        nag: moveNagDraft,
        comment: moveCommentDraft,
      })
      await refreshAllMoves(activeRepertoireId)
      await refreshRepertoireOverview()
    } catch {
      setToast({ type: 'error', message: t({ en: 'Unable to save comment.', fr: "Impossible d'enregistrer le commentaire." }) })
    }
  }, [
    activeRepertoireId,
    moveCommentDraft,
    moveNagDraft,
    refreshAllMoves,
    refreshRepertoireOverview,
    selectedMove?.id,
  ])

  useEffect(() => {
    if (mode !== 'build') return
    if (!selectedMove?.id) return
    const currentNag = selectedMove.nag ?? ''
    const currentComment = selectedMove.comment ?? ''
    if (moveNagDraft === currentNag && moveCommentDraft === currentComment) return
    const timer = window.setTimeout(() => {
      void saveMoveMeta()
    }, 260)
    return () => window.clearTimeout(timer)
  }, [mode, moveCommentDraft, moveNagDraft, saveMoveMeta, selectedMove?.comment, selectedMove?.id, selectedMove?.nag])

  return (
    <div
      className={[
        'flex flex-1 flex-col gap-6 py-8',
        device.isMobile ? 'px-2 sm:px-4' : 'web-shell pl-[224px] pr-[30px] pt-[82px]',
        !device.isMobile ? `web-theme-${visualTheme}` : '',
      ].join(' ')}
    >
      {!device.isMobile ? (
        <>
          <header className="fixed left-0 right-0 top-0 z-[60] bg-[var(--primary)] px-4 py-2">
            <div className="flex w-full items-center justify-between gap-3 pl-2 pr-1">
              <div className="flex items-center gap-3">
                <img src={openingIslandIcon} alt="" className="h-10 w-10 rounded-lg object-cover" />
                <div className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] px-4 py-2 text-base font-bold tracking-tight text-[var(--text-h)]">
                  Opening Grinder
                </div>
              </div>
              <div className="flex items-center gap-2 px-1 py-1">
                <div className="px-2 py-1 text-center text-sm font-medium text-white">
                  {t({ en: 'Last sync', fr: 'Dernière synchro' })} {new Date().toLocaleDateString()}
                </div>
                <UserProfileChrome placement="inline" />
              </div>
            </div>
          </header>
          <aside className="fixed bottom-4 left-4 top-[74px] z-[55] w-[188px] rounded-2xl bg-[#eef2f7] p-3 shadow-[var(--shadow)]">
            <nav className="space-y-2">
              <button type="button" className={['web-nav-btn w-full', view === 'home' ? 'is-active' : ''].join(' ')} onClick={() => setView('home')}>
                {t({ en: 'Home', fr: 'Accueil' })}
              </button>
              <button
                type="button"
                className={['web-nav-btn w-full', view === 'session' && mode === 'build' ? 'is-active' : ''].join(' ')}
                onClick={() => {
                  const fallbackId = activeRepertoireId ?? currentFocusRepertoire?.id ?? repertoires[0]?.id ?? null
                  if (fallbackId) setActiveRepertoireId(fallbackId)
                  setMode('build')
                  setView('session')
                }}
              >
                {t({ en: 'Build', fr: 'Build' })}
              </button>
              <button
                type="button"
                className="web-nav-btn w-full"
                onClick={() => setToast({ type: 'info', message: t({ en: 'Statistics panel coming in web shell.', fr: 'Le panneau statistiques arrive dans le shell web.' }) })}
              >
                {t({ en: 'Statistics', fr: 'Statistiques' })}
              </button>
              <button type="button" className="web-nav-btn w-full" onClick={() => setSettingsOpen(true)}>
                {t({ en: 'Settings', fr: 'Paramètres' })}
              </button>
            </nav>
          </aside>
        </>
      ) : null}
      {view === 'home' ? (
        device.isMobile ? (
          <div className="mx-auto w-full max-w-[920px] text-left">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <img
                    src={openingIslandIcon}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-xl object-cover shadow-sm"
                  />
                  <h1 className="text-2xl font-semibold tracking-tight text-[var(--text-h)]">Opening Grinder</h1>
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button type="button" className="counter mb-0 text-sm" onClick={() => setImportOpen(true)}>
                    {t({ en: 'Import repertoire', fr: 'Importer un répertoire' })}
                  </button>
                  <button type="button" className="counter mb-0 text-sm" onClick={() => setCreateRepertoireOpen(true)}>
                    {t({ en: 'Create repertoire', fr: 'Créer un répertoire' })}
                  </button>
                </div>
              </div>
              <UserProfileChrome placement="inline" />
            </div>

            <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]">
              <div className="space-y-5">
                <HomeSection
                  title={t({ en: 'White', fr: 'Blanc' })}
                  sectionColorDot="white"
                  repertoires={whiteRepertoires}
                  repertoireCounts={repertoireCounts}
                  onOpen={(id) => {
                    setActiveRepertoireId(id)
                    setMode('build')
                    setView('session')
                  }}
                  onExportPgn={handleExportPgn}
                  onShare={(id, title) => setShareTarget({ id, title })}
                  onRename={(r) => setRenameTarget(r)}
                  onDelete={(r) => setModal({ kind: 'confirmDeleteRepertoire', repertoire: r })}
                />
                <HomeSection
                  title={t({ en: 'Black', fr: 'Noir' })}
                  sectionColorDot="black"
                  repertoires={blackRepertoires}
                  repertoireCounts={repertoireCounts}
                  onOpen={(id) => {
                    setActiveRepertoireId(id)
                    setMode('build')
                    setView('session')
                  }}
                  onExportPgn={handleExportPgn}
                  onShare={(id, title) => setShareTarget({ id, title })}
                  onRename={(r) => setRenameTarget(r)}
                  onDelete={(r) => setModal({ kind: 'confirmDeleteRepertoire', repertoire: r })}
                />
              </div>
            </div>
          </div>
        ) : !device.isMobile && mode === 'build' && false ? (
          <div className="mx-auto grid w-full max-w-[1360px] grid-cols-[220px_1fr] gap-6">
            <aside className="web-panel p-4 text-left">
              <div className="mb-4 text-sm font-semibold tracking-tight text-[var(--text-h)]">{activeRepertoire?.title ?? '—'}</div>
              <div className="flex items-center gap-2 pb-4">
                <button
                  type="button"
                  className="web-nav-btn w-full"
                  onClick={() => {
                    if (!activeRepertoireId) return
                    setModal({
                      kind: 'trainStart',
                      fullCount: trainPositions.length,
                      selectionCount: selectionTrainPositions.length,
                      hasSelection: currentNodeId != null,
                    })
                  }}
                  disabled={!activeRepertoireId}
                >
                  {t({ en: 'Train', fr: 'Entraîner' })}
                </button>
                <button type="button" className="web-nav-btn w-full" onClick={() => setView('home')}>
                  {t({ en: 'Home', fr: 'Accueil' })}
                </button>
              </div>
              <div className="border-t border-[var(--border)] pt-4">
                <MoveTreeView
                  forest={forest}
                  pathIds={pathToIdSet(path)}
                  onSelectMove={selectVariant}
                  onDeleteMove={onDeleteMove}
                  onPromoteVariant={onPromoteVariant}
                  onMakeMainLine={onMakeMainLine}
                  onCopyVariantPgn={onCopyVariantPgn}
                />
              </div>
            </aside>
            <div className="grid grid-cols-[minmax(320px,430px)_minmax(540px,1fr)_minmax(260px,340px)] gap-4">
              <section className="web-panel p-3">
                <div className="mb-2 flex items-center justify-end gap-1">
                  <button
                    type="button"
                    className="counter mb-0 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center !p-0 leading-none"
                    aria-label={t({ en: 'Board settings', fr: "Paramètres de l'échiquier" })}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden />
                  </button>
                </div>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Board
                      fen={currentFen}
                      dests={isAnnotating ? new Map<Key, Key[]>() : boardDests}
                      turnColor={turnColor}
                      orientation={boardOrientation}
                      onMove={isAnnotating ? undefined : onBoardMoveBuild}
                      lastMove={undefined}
                      selectedSquare={annotationTool === 'arrow' ? pendingArrowFrom : null}
                      drawableEnabled={showBoardAnnotations}
                      drawableVisible={showBoardAnnotations && mode === 'build'}
                      shapes={currentShapes}
                      annotationAutoShapes={annotationPreviewAutoShapes}
                      onShapesChange={(next) => {
                        setShapesByFen((prev) => ({ ...prev, [currentFen]: next }))
                      }}
                      annotationMode={isAnnotating}
                      annotateVariant={isAnnotating ? (annotationTool === 'arrow' ? 'arrow' : 'circle') : null}
                      onAnnotateStart={onAnnotateStart}
                      onAnnotateMove={onAnnotateMove}
                      onAnnotateEnd={onAnnotateEnd}
                      touchMoveMode={false}
                    />
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 rounded-md border border-red-500 px-1">
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Go to start', fr: 'Revenir au début' })}
                          onClick={() => void goToRoot()}
                        >
                          «
                        </button>
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Previous move', fr: 'Coup précédent' })}
                          onClick={() => void goBack()}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Next move', fr: 'Coup suivant' })}
                          onClick={() => void goForward()}
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Go to end', fr: 'Aller à la fin' })}
                          onClick={() => void goToEnd()}
                        >
                          »
                        </button>
                      </div>
                      <div className="flex items-center gap-1 rounded-md border-2 border-red-500 px-1 py-0.5">
                        <button
                          type="button"
                          className={[
                            'm-0 inline-flex self-start items-start justify-start p-0 leading-none transition-transform active:scale-90',
                            annotationBrush === 'red'
                              ? 'text-red-600'
                              : annotationBrush === 'blue'
                                ? 'text-blue-600'
                                : 'text-emerald-600',
                          ].join(' ')}
                          onClick={() =>
                            setAnnotationBrush((prev) => {
                              const i = ANNOTATION_BRUSH_CYCLE.indexOf(
                                prev as (typeof ANNOTATION_BRUSH_CYCLE)[number],
                              )
                              return ANNOTATION_BRUSH_CYCLE[i === -1 ? 0 : (i + 1) % ANNOTATION_BRUSH_CYCLE.length]
                            })
                          }
                          title={t({
                            en: 'Annotation color: click to cycle Green -> Red -> Blue.',
                            fr: "Couleur d'annotation : clique pour alterner Vert -> Rouge -> Bleu.",
                          })}
                        >
                          <Circle className="h-4 w-4" fill="currentColor" strokeWidth={1.6} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={[
                            'counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0',
                            annotationTool === 'arrow'
                              ? 'border-red-500 bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-red-300'
                              : '',
                          ].join(' ')}
                          aria-pressed={annotationTool === 'arrow'}
                          onClick={() => setAnnotationTool((tool) => (tool === 'arrow' ? 'none' : 'arrow'))}
                          title={t({
                            en: 'Arrow tool: click source then destination square. Click again to disable.',
                            fr: 'Outil flèche : clique la case de départ puis la case d’arrivée. Reclique pour désactiver.',
                          })}
                        >
                          <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={[
                            'counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0',
                            annotationTool === 'circle'
                              ? 'border-red-500 bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-red-300'
                              : '',
                          ].join(' ')}
                          aria-pressed={annotationTool === 'circle'}
                          onClick={() => setAnnotationTool((tool) => (tool === 'circle' ? 'none' : 'circle'))}
                          title={t({
                            en: 'Circle tool: click a square to toggle a circle. Click again to disable.',
                            fr: 'Outil cercle : clique une case pour ajouter/enlever un cercle. Reclique pour désactiver.',
                          })}
                        >
                          <Circle className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={[
                            'counter mb-0 inline-flex h-7 w-7 self-center items-center justify-center rounded-full border border-[var(--border)] !p-0 transition-transform active:scale-90',
                            annotationBrush === 'red'
                              ? 'bg-red-600'
                              : annotationBrush === 'blue'
                                ? 'bg-blue-600'
                                : 'bg-emerald-600',
                          ].join(' ')}
                          style={{ color: '#fff' }}
                          onClick={() =>
                            setAnnotationBrush((prev) => {
                              const i = ANNOTATION_BRUSH_CYCLE.indexOf(prev as (typeof ANNOTATION_BRUSH_CYCLE)[number])
                              return ANNOTATION_BRUSH_CYCLE[i === -1 ? 0 : (i + 1) % ANNOTATION_BRUSH_CYCLE.length]
                            })
                          }
                          title={t({
                            en: 'Annotation color: click to cycle Green -> Red -> Blue.',
                            fr: "Couleur d'annotation : clique pour alterner Vert -> Rouge -> Bleu.",
                          })}
                        >
                          <span className="h-3 w-3 rounded-full bg-white/90" aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>
                  <aside className="w-[88px] shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 text-center">
                    <div className="text-[10px] font-semibold uppercase tracking-wide opacity-70">Stockfish</div>
                    <button
                      type="button"
                      className={[
                        'mx-auto mt-2 inline-flex h-7 w-7 items-center justify-center rounded-full',
                        engineBuildOn ? 'bg-emerald-500/20 text-emerald-600' : 'bg-[var(--code-bg)] text-[var(--text)]',
                      ].join(' ')}
                      aria-pressed={engineBuildOn}
                      onClick={() => setEngineBuildOn((v) => !v)}
                      title={t({ en: 'Engine on/off', fr: 'Moteur on/off' })}
                    >
                      <Power className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <div className="mt-2 text-xs font-semibold text-[var(--text-h)]">
                      {engineBuildOn ? (positionEvalBusy ? '…' : formatEval(positionEval)) : 'OFF'}
                    </div>
                    <div className="mt-2 h-16">
                      <EvalBar eval={positionEval} bottomColor={boardOrientation} className="mx-auto h-full min-h-0 w-2" />
                    </div>
                  </aside>
                </div>
              </section>
              <section className="web-panel p-3 text-left">
                <OpeningExplorer
                  fen={currentFen}
                  collapsed={openingExplorerCollapsed}
                  onToggleCollapsed={() => setOpeningExplorerCollapsed((v) => !v)}
                  onPlayMove={(uci) => void onPlayExplorerMove(uci)}
                  stockfishActive={engineBuildOn}
                  stockfishEvaluateFen={engineBuildOn ? stockfishEvaluateFen : undefined}
                />
              </section>
              <section className="web-panel p-3 text-left">
                <div className="mb-2 text-sm font-semibold text-[var(--text-h)]">{t({ en: 'Analysis', fr: 'Analyse' })}</div>
                {selectedMove ? (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-left text-sm">
                    <div className="text-xs font-medium text-[var(--text-h)]">{t({ en: 'Move', fr: 'Coup' })}</div>
                    <div className="mt-1 font-mono text-[var(--text-h)]">
                      {selectedMove?.notation}
                      {formatNagForInline(selectedMove?.nag)}
                    </div>
                    <div className="mt-0.5">
                      <div className="mb-0.5 text-[6px] font-medium text-[var(--text-h)]">{t({ en: 'PGN annotation', fr: 'Annotation PGN' })}</div>
                      <div className="flex flex-wrap gap-0">
                        {['', '!', '?', '!!', '??', '!?', '?!', '=', '+/=', '=/+', '+-', '-+', '∞'].map((nag) => (
                          <button
                            key={nag || 'none'}
                            type="button"
                            className={[
                              'counter min-w-[20px] !px-0.5 !py-0 text-[6px]',
                              moveNagDraft === nag ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]' : '',
                            ].join(' ')}
                            disabled={busy}
                            onClick={() => setMoveNagDraft(nag)}
                            title={nag || t({ en: 'No annotation', fr: 'Aucune annotation' })}
                          >
                            {nag || '∅'}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm opacity-80">
                    {t({ en: 'Select a move to display details.', fr: 'Sélectionne un coup pour afficher les détails.' })}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : !device.isMobile && mode === 'build' && false ? (
          <div className="mx-auto grid w-full max-w-[1360px] grid-cols-[300px_460px_1fr] gap-4">
            <aside className="web-panel p-4 text-left">
              <div className="mb-3 text-xs font-medium uppercase tracking-wide opacity-70">
                {t({ en: 'Current repertoire', fr: 'Répertoire actif' })}
              </div>
              <select
                className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-h)]"
                value={activeRepertoireId ?? ''}
                onChange={(e) => {
                  const nextId = e.target.value
                  if (!nextId) return
                  setActiveRepertoireId(nextId)
                  setMode('build')
                }}
              >
                {repertoires.map((rep) => (
                  <option key={rep.id} value={rep.id}>
                    {rep.title}
                  </option>
                ))}
              </select>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  className="web-nav-btn w-full justify-center"
                  onClick={() => {
                    if (!activeRepertoireId) return
                    setModal({
                      kind: 'trainStart',
                      fullCount: trainPositions.length,
                      selectionCount: selectionTrainPositions.length,
                      hasSelection: currentNodeId != null,
                    })
                  }}
                  disabled={!activeRepertoireId}
                >
                  {t({ en: 'Train', fr: 'Entraîner' })}
                </button>
                <button
                  type="button"
                  className="web-nav-btn w-full justify-center"
                  onClick={() =>
                    setModal({
                      kind: 'puzzleStart',
                      hasSelection: currentNodeId != null,
                    })
                  }
                  disabled={!activeRepertoireId || trainPositions.length === 0}
                >
                  {t({ en: 'Puzzles', fr: 'Puzzles' })}
                </button>
                <button type="button" className="web-nav-btn w-full justify-center" onClick={() => setView('home')}>
                  {t({ en: 'Home', fr: 'Accueil' })}
                </button>
              </div>
              <div className="mt-4 border-t border-[var(--border)] pt-4">
                <MoveTreeView
                  forest={forest}
                  pathIds={pathToIdSet(path)}
                  onSelectMove={selectVariant}
                  onDeleteMove={onDeleteMove}
                  onPromoteVariant={onPromoteVariant}
                  onMakeMainLine={onMakeMainLine}
                  onCopyVariantPgn={onCopyVariantPgn}
                />
              </div>
            </aside>

            <section className="web-panel p-3">
              <div className="flex items-center gap-3">
                <aside className="flex w-12 shrink-0 flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-1.5">
                  <button
                    type="button"
                    className={[
                      'inline-flex h-8 w-8 items-center justify-center rounded-[6px] border-2 transition-colors',
                      annotationTool === 'arrow'
                        ? 'border-red-500 bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-red-300'
                        : 'border-transparent text-[var(--text)] opacity-80 hover:bg-[var(--code-bg)]',
                    ].join(' ')}
                    aria-pressed={annotationTool === 'arrow'}
                    title={t({
                      en: 'Arrow tool: click source then destination square. Click again to disable.',
                      fr: 'Outil flèche : clique la case de départ puis la case d’arrivée. Reclique pour désactiver.',
                    })}
                    onClick={() => setAnnotationTool((tool) => (tool === 'arrow' ? 'none' : 'arrow'))}
                  >
                    <ArrowUpRight className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={[
                      'inline-flex h-8 w-8 items-center justify-center rounded-[6px] border-2 transition-colors',
                      annotationTool === 'circle'
                        ? 'border-red-500 bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-red-300'
                        : 'border-transparent text-[var(--text)] opacity-80 hover:bg-[var(--code-bg)]',
                    ].join(' ')}
                    aria-pressed={annotationTool === 'circle'}
                    title={t({
                      en: 'Circle tool: click a square to toggle a circle. Click again to disable.',
                      fr: 'Outil cercle : clique une case pour ajouter/enlever un cercle. Reclique pour désactiver.',
                    })}
                    onClick={() => setAnnotationTool((tool) => (tool === 'circle' ? 'none' : 'circle'))}
                  >
                    <Circle className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className={[
                      'inline-flex h-8 w-8 self-center items-center justify-center rounded-full border border-[var(--border)] transition-transform active:scale-90',
                      annotationBrush === 'red'
                        ? 'bg-red-600'
                        : annotationBrush === 'blue'
                          ? 'bg-blue-600'
                          : 'bg-emerald-600',
                    ].join(' ')}
                    title={t({ en: 'Cycle annotation color', fr: "Changer la couleur d'annotation" })}
                    onClick={() =>
                      setAnnotationBrush((prev) => {
                        const i = ANNOTATION_BRUSH_CYCLE.indexOf(
                          prev as (typeof ANNOTATION_BRUSH_CYCLE)[number],
                        )
                        return ANNOTATION_BRUSH_CYCLE[i === -1 ? 0 : (i + 1) % ANNOTATION_BRUSH_CYCLE.length]
                      })
                    }
                  >
                    <span className="h-3 w-3 rounded-full bg-white/90" aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="counter mb-0 inline-flex h-8 w-8 items-center justify-center !p-0 leading-none"
                    aria-label={t({ en: 'Board settings', fr: "Paramètres de l'échiquier" })}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="h-[16px] w-[16px]" strokeWidth={2} aria-hidden />
                  </button>
                </aside>
                <div className="flex-1">
                  <Board
                    fen={currentFen}
                    dests={isAnnotating ? new Map<Key, Key[]>() : boardDests}
                    turnColor={turnColor}
                    orientation={boardOrientation}
                    onMove={isAnnotating ? undefined : onBoardMoveBuild}
                    lastMove={undefined}
                    selectedSquare={annotationTool === 'arrow' ? pendingArrowFrom : null}
                    drawableEnabled={showBoardAnnotations}
                    drawableVisible={showBoardAnnotations && mode === 'build'}
                    shapes={currentShapes}
                    annotationAutoShapes={annotationPreviewAutoShapes}
                    onShapesChange={(next) => {
                      setShapesByFen((prev) => ({ ...prev, [currentFen]: next }))
                    }}
                    annotationMode={isAnnotating}
                    annotateVariant={isAnnotating ? (annotationTool === 'arrow' ? 'arrow' : 'circle') : null}
                    onAnnotateStart={onAnnotateStart}
                    onAnnotateMove={onAnnotateMove}
                    onAnnotateEnd={onAnnotateEnd}
                    touchMoveMode={false}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3 text-left">
              <div className="web-panel p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-[var(--text-h)]">Stockfish</div>
                  <button
                    type="button"
                    className={[
                      'counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0 leading-none',
                      engineBuildOn ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]' : '',
                    ].join(' ')}
                    aria-pressed={engineBuildOn}
                    aria-label="Analyse Stockfish"
                    onClick={() => setEngineBuildOn((v) => !v)}
                  >
                    <Brain className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-2xl font-semibold tracking-tight text-[var(--text-h)]">
                    {positionEvalBusy ? '…' : formatEval(positionEval)}
                  </div>
                  <div className="h-20">
                    <EvalBar eval={positionEval} bottomColor={boardOrientation} className="min-h-0 w-3 h-full" />
                  </div>
                </div>
                <div className="mt-2 text-xs opacity-75">
                  {engineBuildOn
                    ? t({ en: 'Live eval on current position.', fr: 'Evaluation en direct sur la position actuelle.' })
                    : t({ en: 'Enable engine for live eval.', fr: "Active le moteur pour l'évaluation en direct." })}
                </div>
              </div>
              <div className="web-panel p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-sm font-semibold text-[var(--text-h)]">{t({ en: 'Opening explorer', fr: 'Explorateur d’ouvertures' })}</div>
                  <UserProfileChrome placement="inline" />
                </div>
                <OpeningExplorer
                  fen={currentFen}
                  collapsed={openingExplorerCollapsed}
                  onToggleCollapsed={() => setOpeningExplorerCollapsed((v) => !v)}
                  onPlayMove={(uci) => void onPlayExplorerMove(uci)}
                  stockfishActive={engineBuildOn}
                  stockfishEvaluateFen={engineBuildOn ? stockfishEvaluateFen : undefined}
                />
              </div>
            </section>
          </div>
        ) : (
          <div className="w-full text-left">
            <section className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="web-dashboard-card w-fit max-w-[980px] rounded-[22px] bg-[#edf2f8] pb-2">
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-[#dfe5ec] p-3 text-[var(--text-h)]">♟</div>
                      <div>
                        <div className="text-xs font-medium uppercase tracking-wide opacity-65">
                          {t({ en: 'Current focus', fr: 'Focus actuel' })}
                        </div>
                        <div className="text-[22px] font-bold tracking-tight text-[var(--text-h)]">
                          {currentFocusRepertoire?.title ?? '—'}
                        </div>
                        {currentFocusRepertoire?.description ? (
                          <div className="mt-1 text-xs italic text-[var(--text)] opacity-75">{currentFocusRepertoire.description}</div>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-center">
                        <div className="text-xl font-bold text-[var(--text-h)]">
                          {currentFocusRepertoire ? `${repertoireMastery[currentFocusRepertoire.id] ?? 0}%` : '0%'}
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-wider opacity-65">Mastery</div>
                      </div>
                      <div className="p-1">
                        <RepertoirePreviewBoard
                          fen={currentFocusRepertoire ? repertoireMainLineFens[currentFocusRepertoire.id] ?? new Chess().fen() : new Chess().fen()}
                          orientation={currentFocusRepertoire?.side ?? 'white'}
                          sizeClassName="h-[64px] w-[64px]"
                        />
                      </div>
                      <button
                        type="button"
                        className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold text-white"
                        onClick={() => {
                          if (!currentFocusRepertoire) return
                          setActiveRepertoireId(currentFocusRepertoire.id)
                          setMode('build')
                          setView('session')
                          window.setTimeout(() => {
                            setModal({
                              kind: 'trainStart',
                              fullCount: trainPositions.length,
                              selectionCount: selectionTrainPositions.length,
                              hasSelection: currentNodeId != null,
                            })
                          }, 0)
                        }}
                      >
                        {t({ en: 'Train Now', fr: 'Train' })}
                      </button>
                      <button
                        type="button"
                        className="rounded-full bg-[#dfe5ec] px-4 py-1.5 text-xs font-semibold text-[var(--text-h)]"
                        onClick={() => {
                          if (!currentFocusRepertoire) return
                          setActiveRepertoireId(currentFocusRepertoire.id)
                          setMode('build')
                          setView('session')
                          window.setTimeout(() => {
                            setModal({
                              kind: 'puzzleStart',
                              hasSelection: currentNodeId != null,
                            })
                          }, 0)
                        }}
                      >
                        {t({ en: 'Puzzles', fr: 'Puzzles' })}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="ml-auto flex flex-nowrap items-center justify-end gap-2 self-center">
                  <button
                    type="button"
                    className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold whitespace-nowrap text-white"
                    onClick={() => setCreateRepertoireOpen(true)}
                  >
                    {t({ en: 'Create repertoire', fr: 'Créer un répertoire' })}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold whitespace-nowrap text-white"
                    onClick={() => setImportOpen(true)}
                  >
                    {t({ en: 'Import repertoire', fr: 'Importer un répertoire' })}
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-[var(--primary)] px-4 py-1.5 text-xs font-semibold whitespace-nowrap text-white"
                    onClick={() =>
                      setToast({
                        type: 'info',
                        message: t({
                          en: 'Repertoire explorer panel is coming next.',
                          fr: 'Le panneau exploration des répertoires arrive ensuite.',
                        }),
                      })
                    }
                  >
                    {t({ en: 'Explore repertoires', fr: 'Explorer les répertoires' })}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between pl-3">
                <h2 className="m-0 text-4xl font-bold tracking-tight text-[var(--text-h)]">
                  {t({ en: 'Active Repertoires', fr: 'Répertoires actifs' })}
                </h2>
              </div>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {[...whiteRepertoires, ...blackRepertoires].map((rep) => (
                  <div
                    key={rep.id}
                    className="web-dashboard-card rounded-[22px] bg-[var(--social-bg)] text-left"
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setActiveRepertoireId(rep.id)
                      setMode('build')
                      setView('session')
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter' && e.key !== ' ') return
                      e.preventDefault()
                      setActiveRepertoireId(rep.id)
                      setMode('build')
                      setView('session')
                    }}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="min-w-0 whitespace-normal text-[24px] font-bold leading-tight tracking-tight break-words text-[var(--text-h)]">
                            {rep.title}
                          </div>
                          <span
                            className={[
                              'inline-flex rounded-md px-2 py-1 text-[11px] font-semibold leading-none',
                              rep.side === 'white' ? 'border border-neutral-300 bg-white text-black' : 'bg-black text-white',
                            ].join(' ')}
                          >
                            {rep.side === 'white' ? t({ en: 'White', fr: 'Blanc' }) : t({ en: 'Black', fr: 'Noir' })}
                          </span>
                        </div>
                        {rep.description ? (
                          <div className="mt-0.5 text-[11px] italic break-words text-[var(--text)] opacity-75">{rep.description}</div>
                        ) : null}
                      </div>
                      <div className="rounded-xl bg-[#f2f4f8] px-3 py-1.5 text-sm font-bold text-[var(--primary)]">
                        {repertoireMastery[rep.id] ?? 0}%
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[12px]">
                      <div className="p-1">
                        <RepertoirePreviewBoard
                          fen={repertoireMainLineFens[rep.id] ?? new Chess().fen()}
                          orientation={rep.side}
                          sizeClassName="h-[74px] w-[74px]"
                        />
                      </div>
                      <div className="space-y-1 px-1 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <span>{t({ en: 'Max depth', fr: 'Profondeur max' })}</span>
                          <strong>{repertoireMaxDepth[rep.id] ?? 0}</strong>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span>{t({ en: 'Positions', fr: 'Positions' })}</span>
                          <strong>{repertoireCounts[rep.id] ?? 0}</strong>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[11px]">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                          title={t({ en: 'Rename', fr: 'Renommer' })}
                          onClick={(e) => {
                            e.stopPropagation()
                            setRenameTarget(rep)
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-red-500/15 hover:text-red-600 hover:opacity-100 dark:hover:text-red-400"
                          title={t({ en: 'Delete repertoire', fr: 'Supprimer le répertoire' })}
                          onClick={(e) => {
                            e.stopPropagation()
                            setModal({ kind: 'confirmDeleteRepertoire', repertoire: rep })
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                          title={t({ en: 'Download PGN', fr: 'Télécharger PGN' })}
                          onClick={(e) => {
                            e.stopPropagation()
                            void handleExportPgn(rep.id)
                          }}
                        >
                          <Download className="h-3.5 w-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                          title={t({ en: 'Share', fr: 'Partager' })}
                          onClick={(e) => {
                            e.stopPropagation()
                            setShareTarget({ id: rep.id, title: rep.title })
                          }}
                        >
                          <Share2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="opacity-70">
                          {t({ en: 'Last train:', fr: 'Dernier entraînement :' })} {formatLastTrainLabel(rep.lastTrainDayKey, t)}
                        </span>
                        <span className="rounded-lg bg-[#ffe7dc] px-2 py-1 font-semibold text-[#8d3c1a]">
                          {t({ en: '{count} due', fr: '{count} à revoir' }, { count: repertoireDueCounts[rep.id] ?? 0 })}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )
      ) : (
        <>
          {device.isMobile ? (
            <div className="mx-auto flex w-full max-w-[1126px] justify-end">
              <UserProfileChrome placement="inline" />
            </div>
          ) : null}
          {mode === 'train' ? (
          <div className={['mx-auto w-full', device.isMobile ? 'max-w-none px-0' : 'max-w-[420px]'].join(' ')}>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-2.5 shadow-[var(--shadow)] sm:p-3">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs font-medium text-[var(--text-h)]">
                    {activeRepertoire?.title ?? '—'}
                  </span>
                  {activeRepertoire?.side ? (
                    <span
                      className={[
                        'h-2 w-2 shrink-0 rounded-full border',
                        activeRepertoire.side === 'white'
                          ? 'border-[var(--border)] bg-white'
                          : 'border-neutral-700 bg-neutral-900 dark:border-neutral-600 dark:bg-neutral-950',
                      ].join(' ')}
                      title={activeRepertoire.side === 'white' ? t({ en: 'White', fr: 'Blancs' }) : t({ en: 'Black', fr: 'Noirs' })}
                      aria-label={activeRepertoire.side === 'white' ? t({ en: 'White', fr: 'Blancs' }) : t({ en: 'Black', fr: 'Noirs' })}
                    />
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" className="train-accent-btn" onClick={() => setView('home')}>
                    Home
                  </button>
                  <button
                    type="button"
                    className="train-accent-btn"
                    onClick={() => {
                      if (trainRunActive) suspendTrainRun()
                      else setMode('build')
                    }}
                  >
                    Build
                  </button>
                  <button
                    type="button"
                    className="train-accent-btn train-accent-btn--icon inline-flex items-center justify-center"
                    aria-label={t({ en: 'Board settings', fr: "Paramètres de l'échiquier" })}
                    title={t({ en: 'Settings', fr: 'Paramètres' })}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="h-[12.375px] w-[12.375px]" strokeWidth={2} aria-hidden />
                  </button>
                </div>
              </div>
              <div className={trainMissPulse ? 'train-miss-shake' : ''}>
                <Board
                  fen={currentFen}
                  dests={!isUsersTurn ? new Map() : dests}
                  showDests={showDests}
                  turnColor={turnColor}
                  orientation={boardOrientation}
                  onMove={onBoardMoveTrain}
                  lastMove={undefined}
                  selectedSquare={hintSelectedSquare}
                  drawableEnabled={showBoardAnnotations || trainGreyAutoShapes.length > 0}
                  drawableVisible={showBoardAnnotations || trainGreyAutoShapes.length > 0}
                  shapes={currentShapes}
                  annotationAutoShapes={trainGreyAutoShapes}
                  onShapesChange={(next) => {
                    setShapesByFen((prev) => ({ ...prev, [currentFen]: next }))
                  }}
                  annotationMode={false}
                  touchMoveMode={device.isMobile}
                />
              </div>

                <div className="mt-1.5 text-left">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={[
                        'toggle-switch toggle-switch--sm',
                        showBoardAnnotations ? 'is-on' : '',
                      ].join(' ')}
                      role="switch"
                      aria-checked={showBoardAnnotations}
                      aria-label={t({ en: 'Show board annotations', fr: "Afficher les annotations sur l'échiquier" })}
                      onClick={() => setShowBoardAnnotations((v) => !v)}
                    >
                      <span className="toggle-thumb" />
                    </button>
                    <span className="text-[10px] uppercase tracking-wide text-[var(--text-h)] opacity-50">
                      Annotations
                    </span>
                  </div>
                  {showBoardAnnotations && selectedMove?.comment?.trim() ? (
                    <div className="mt-1 rounded border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[10px] leading-snug text-[var(--text-h)]">
                      <p className="whitespace-pre-wrap opacity-90">{selectedMove.comment.trim()}</p>
                    </div>
                  ) : null}
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-left">
                  <div className="text-xs">
                    <div className="font-medium text-[var(--text-h)]">Run</div>
                    {!replayingSequence ? (
                      <div className="font-mono text-[11px]">
                        {children.length === 0
                          ? t({ en: 'End of line', fr: 'Fin de ligne' })
                          : isUsersTurn
                            ? expectedTrainRepliesList.length > 1
                              ? t(
                                  { en: 'Your turn · {count} answer(s) to find', fr: 'À toi · {count} réponse(s) à trouver' },
                                  { count: trainRepliesRemaining },
                                )
                              : t({ en: 'Your turn', fr: 'À toi' })
                            : t({ en: 'Reply…', fr: 'Réponse…' })}
                      </div>
                    ) : null}
                    {trainRunActive ? (
                      <>
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--code-bg)]">
                          <div
                            className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                            style={{ width: `${trainTotal === 0 ? 0 : (trainPassed / trainTotal) * 100}%` }}
                          />
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] opacity-80">
                          <div>
                            {t(
                              { en: 'Remaining: {remaining} · Passed: {passed} · Failed: {failed}', fr: 'Restantes: {remaining} · Passées: {passed} · Failed: {failed}' },
                              { remaining: trainRemaining, passed: trainPassed, failed: trainFailed },
                            )}
                          </div>
                          <div className="font-mono">{t({ en: 'Depth = {depth}', fr: 'Profondeur = {depth}' }, { depth: path.length })}</div>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {trainCombo >= 3 ? (
                    <div
                      className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-h)]"
                      title="Combo"
                    >
                      <span className="select-none">🔥</span>
                      <span className="font-mono">{trainCombo}</span>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="train-accent-btn"
                    disabled={!isUsersTurn || !hintMoveKeys}
                    onClick={() => {
                      if (!isUsersTurn) return
                      if (!hintMoveKeys) return
                      setTrainFoundAnswerIds([])
                      setTrainGreyAutoShapes([])
                      if (trainRunActive) {
                        const posKey = currentNodeId ?? null
                        if (!failedPositionsRef.current.has(posKey)) {
                          failedPositionsRef.current.add(posKey)
                          setTrainFailed((n) => n + 1)
                        }
                      }
                      setTrainCombo(0)
                      setHintStep((prev) => (prev === 0 ? 1 : prev === 1 ? 2 : 0))
                    }}
                  >
                    Hint
                  </button>
                  <button
                    type="button"
                    className="train-accent-btn"
                    disabled={busy}
                    onClick={() => {
                      void replayToPositionId(currentNodeId)
                    }}
                  >
                    Replay moves
                  </button>
                  <button
                    type="button"
                    className="train-accent-btn"
                    disabled={busy || replayingSequence}
                    onClick={() => suspendTrainRun()}
                  >
                    {t({ en: 'Suspend', fr: 'Suspendre' })}
                  </button>
                </div>

                {trainMissPulse ? (
                  <div className="mt-1.5 rounded border border-red-400/40 bg-red-500/10 px-2 py-1 text-left text-[10px] font-medium text-red-600 dark:text-red-300">
                    {t({ en: 'Incorrect move.', fr: 'Coup incorrect.' })}
                  </div>
                ) : null}

                <div className="mt-1.5 text-left">
                  <div className="text-[11px] font-medium text-[var(--text-h)]">{t({ en: 'Path', fr: 'Chemin' })}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {path.length === 0 ? (
                      <span className="rounded bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-h)]">
                        (root)
                      </span>
                    ) : (
                      path.map((move, depth) => (
                        <span
                          key={move.id}
                          className="rounded bg-[var(--code-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-h)]"
                        >
                          {moveNumberPrefix(depth, depth === 0)}
                          {formatMoveWithNag(move)}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {hintStep > 0 ? (
                  <div className="mt-1.5 text-left text-[10px] opacity-80">
                    {hintStep === 1 ? t({ en: 'Hint: piece to move', fr: 'Hint: pièce à jouer' }) : t({ en: 'Hint: destination square', fr: 'Hint: case de destination' })}
                  </div>
                ) : null}
            </div>
          </div>
        ) : mode === 'puzzle' ? (
          <div className={['mx-auto w-full', device.isMobile ? 'max-w-none px-0' : 'max-w-[420px]'].join(' ')}>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-2.5 shadow-[var(--shadow)] sm:p-3">
              <div className="mb-2 flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-[var(--text-h)]">
                    {activeRepertoire?.title ?? '—'} · {t({ en: 'Puzzles', fr: 'Puzzles' })}
                  </div>
                  <div className="mt-0.5 text-[10px] opacity-80">
                    {activePuzzle
                      ? t({ en: 'Puzzle {index}/{total} · ELO {elo}', fr: 'Puzzle {index}/{total} · ELO {elo}' }, { index: puzzleIndex + 1, total: puzzleQueue.length, elo: activePuzzle.rating })
                      : t({ en: 'No active puzzle', fr: 'Aucun puzzle actif' })}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <button type="button" className="train-accent-btn" onClick={() => setView('home')}>
                    Home
                  </button>
                  <button type="button" className="train-accent-btn" onClick={() => setMode('build')}>
                    Build
                  </button>
                  <button
                    type="button"
                    className="train-accent-btn train-accent-btn--icon inline-flex items-center justify-center"
                    aria-label={t({ en: 'Board settings', fr: "Paramètres de l'échiquier" })}
                    title={t({ en: 'Settings', fr: 'Paramètres' })}
                    onClick={() => setSettingsOpen(true)}
                  >
                    <Settings className="h-[12.375px] w-[12.375px]" strokeWidth={2} aria-hidden />
                  </button>
                </div>
              </div>

              <Board
                fen={puzzleFen ?? new Chess().fen()}
                dests={puzzleDests}
                showDests={showDests}
                turnColor={puzzleTurnColor ?? 'white'}
                orientation={boardOrientation}
                onMove={onBoardMovePuzzle}
                lastMove={undefined}
                selectedSquare={null}
                drawableEnabled
                drawableVisible
                shapes={[]}
                annotationAutoShapes={puzzleHintShape}
                onShapesChange={() => {
                  /* no-op in puzzle mode */
                }}
                annotationMode={false}
                touchMoveMode={device.isMobile}
              />

              <PuzzleSessionTimer startedAtMs={puzzleStartedAtMs} averageMs={puzzleAverageMs} />

              <div className="mt-2 flex items-center gap-1 text-[11px]">
                {(['easy', 'medium', 'hard'] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={[
                      'train-accent-btn',
                      puzzleDifficulty === level ? 'ring-1 ring-[var(--accent)]' : '',
                    ].join(' ')}
                    disabled={puzzleLoading}
                    onClick={() => reloadPuzzleQueueForDifficulty(level)}
                  >
                    {level === 'easy' ? t({ en: 'Easy', fr: 'Facile' }) : level === 'medium' ? t({ en: 'Medium', fr: 'Moyen' }) : t({ en: 'Hard', fr: 'Difficile' })}
                  </button>
                ))}
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="train-accent-btn inline-flex items-center gap-1"
                  onClick={skipPuzzle}
                  disabled={!activePuzzle}
                >
                  <SkipForward className="h-3 w-3" aria-hidden />
                  {t({ en: 'Next puzzle', fr: 'Puzzle suivant' })}
                </button>
                <button
                  type="button"
                  className="train-accent-btn inline-flex items-center gap-1"
                  onClick={showPuzzleSolution}
                  disabled={!activePuzzle}
                >
                  <Eye className="h-3 w-3" aria-hidden />
                  {t({ en: 'Show move', fr: 'Montrer le coup' })}
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1">
                {puzzleResultEntries.length === 0 ? (
                  <span className="text-[10px] opacity-70">{t({ en: 'Session in progress…', fr: 'Session en cours…' })}</span>
                ) : (
                  puzzleResultEntries.map((entry, i) => (
                    <button
                      type="button"
                      key={`${entry.puzzleIndex}-${entry.result}-${i}`}
                      className={[
                        'inline-flex h-5 w-5 items-center justify-center rounded-full border text-[10px] transition-opacity hover:opacity-90',
                        entry.result === 'pass'
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600'
                          : 'border-red-500/50 bg-red-500/10 text-red-600',
                      ].join(' ')}
                      title={t(
                        {
                          en: '{result} · Jump to puzzle #{index}',
                          fr: '{result} · Revenir au puzzle #{index}',
                        },
                        {
                          result: entry.result === 'pass' ? t({ en: 'Passed', fr: 'Réussi' }) : t({ en: 'Failed', fr: 'Raté' }),
                          index: entry.puzzleIndex + 1,
                        },
                      )}
                      onClick={() => jumpToPuzzleFromHistory(entry.puzzleIndex)}
                    >
                      {entry.result === 'pass' ? (
                        <Check className="h-3 w-3" aria-hidden />
                      ) : (
                        <X className="h-3 w-3" aria-hidden />
                      )}
                    </button>
                  ))
                )}
                {puzzleFeedback ? (
                  <span
                    className={[
                      'ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      puzzleFeedback === 'pass' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-red-500/15 text-red-600',
                    ].join(' ')}
                  >
                    {puzzleFeedback === 'pass' ? 'Correct' : 'Incorrect'}
                  </span>
                ) : null}
              </div>

              <div className="mt-2 text-left text-[10px] opacity-80">
                {t({ en: 'Target openings', fr: 'Ouvertures ciblées' })}: {puzzleOpeningTags.slice(0, 5).join(', ') || '—'}
                {puzzleOpeningTags.length > 5 ? ` +${puzzleOpeningTags.length - 5}` : ''}
              </div>
            </div>
          </div>
        ) : (
          <div
            className={[
              'w-full gap-4',
              device.isMobile && mode === 'build'
                ? 'flex flex-col pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))]'
                : !device.isMobile && mode === 'build'
                  ? 'grid grid-cols-[30%_50%_20%] pr-[30px]'
                  : 'grid grid-cols-1 lg:grid-cols-[340px_1fr]',
            ].join(' ')}
          >
            <aside
              className={[
                'rounded-xl border border-[var(--border)] bg-[var(--social-bg)] shadow-[var(--shadow)]',
                device.isMobile ? 'p-2 sm:p-4' : 'p-4',
                device.isMobile && mode === 'build' && mobileBuildTab !== 'tree' ? 'hidden' : '',
              ].join(' ')}
            >
              {!device.isMobile && mode === 'build' ? (
                <div className="mb-3">
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide opacity-70">
                    {t({ en: 'Current repertoire', fr: 'Répertoire actif' })}
                  </div>
                  <select
                    className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text-h)]"
                    value={activeRepertoireId ?? ''}
                    onChange={(e) => {
                      const nextId = e.target.value
                      if (!nextId) return
                      setActiveRepertoireId(nextId)
                      setMode('build')
                    }}
                  >
                    {repertoires.map((rep) => (
                      <option key={rep.id} value={rep.id}>
                        {rep.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}
              <div className="flex items-center justify-start gap-3">
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="mb-0 inline-flex h-9 items-center rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white"
                    onClick={() => {
                      if (!activeRepertoireId) return
                      setModal({
                        kind: 'trainStart',
                        fullCount: trainPositions.length,
                        selectionCount: selectionTrainPositions.length,
                        hasSelection: currentNodeId != null,
                      })
                    }}
                    disabled={!activeRepertoireId}
                  >
                    Train
                  </button>
                  <button
                    type="button"
                    className="mb-0 inline-flex h-9 items-center rounded-md bg-[var(--accent-bg)] px-3 text-sm font-semibold text-[var(--accent)]"
                    onClick={() =>
                      setModal({
                        kind: 'puzzleStart',
                        hasSelection: currentNodeId != null,
                      })
                    }
                    disabled={!activeRepertoireId || trainPositions.length === 0}
                    title={t({ en: 'Puzzles linked to repertoire', fr: 'Puzzles liés au répertoire' })}
                  >
                    Puzzles
                  </button>
                </div>
              </div>

              {trainRunSuspended ? (
                <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--accent-bg)] px-3 py-3 text-left text-sm text-[var(--text-h)]">
                  <div className="text-xs font-medium opacity-80">{t({ en: 'Training paused', fr: 'Entraînement en pause' })}</div>
                  <div className="mt-2 text-xs opacity-75">
                    {t(
                      { en: 'Passed: {passed}/{total} · Remaining: {remaining} · Fails: {failed}', fr: 'Passées: {passed} / {total} · Restantes: {remaining} · Échecs: {failed}' },
                      { passed: trainPassed, total: trainTotal, remaining: trainRemaining, failed: trainFailed },
                    )}
                  </div>
                  <button
                    type="button"
                    className="counter mt-3 w-full"
                    disabled={busy || replayingSequence}
                    onClick={() => void resumeTrainRun()}
                  >
                    {t({ en: 'Resume training', fr: "Reprendre l'entraînement" })}
                  </button>
                </div>
              ) : null}

              <div className="mt-4">
                <MoveTreeView
                  forest={forest}
                  pathIds={pathToIdSet(path)}
                  onSelectMove={selectVariant}
                  onDeleteMove={onDeleteMove}
                  onPromoteVariant={onPromoteVariant}
                  onMakeMainLine={onMakeMainLine}
                  onCopyVariantPgn={onCopyVariantPgn}
                />
              </div>

              {mode === 'build' && selectedMove ? (
                <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-left text-sm">
                  <div className="text-sm text-[var(--text-h)]">
                    {t({ en: 'Move:', fr: 'Coup :' })}{' '}
                    <span className="font-mono font-bold text-[var(--text-h)]">
                      {selectedMove.notation}
                      {formatNagForInline(moveNagDraft || selectedMove.nag)}
                    </span>
                  </div>

                  <label className="mt-0.5 block text-xs font-medium text-[var(--text-h)]" htmlFor="nagSelect">
                    {t({ en: 'PGN annotation', fr: 'Annotation PGN' })}
                  </label>
                  <div className="mt-0.5 flex flex-nowrap gap-0.5 overflow-x-auto">
                    {['', '!', '?', '!!', '??', '!?', '?!', '=', '+/=', '=/+', '+-', '-+', '∞'].map((nag) => (
                      <button
                        key={nag || 'none'}
                        type="button"
                        className={[
                          'counter min-w-[20px] !px-0.5 !py-0 text-[6px] leading-none',
                          moveNagDraft === nag ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]' : '',
                        ].join(' ')}
                        disabled={busy}
                        onClick={() => setMoveNagDraft(nag)}
                        title={nag || t({ en: 'No annotation', fr: 'Aucune annotation' })}
                      >
                        {nag || '∅'}
                      </button>
                    ))}
                  </div>

                  <label
                    className="mt-1 block text-sm font-medium text-[var(--text-h)]"
                    htmlFor="commentInput"
                  >
                    {t({ en: 'Comment', fr: 'Commentaire' })}
                  </label>
                  <textarea
                    id="commentInput"
                    className="mt-1 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    rows={3}
                    value={moveCommentDraft}
                    onChange={(e) => setMoveCommentDraft(e.target.value)}
                    disabled={busy}
                  />

                </div>
              ) : null}

              {toast && (
                <div
                  className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                  role="status"
                >
                  <span className="font-medium">{toast.type === 'error' ? 'Erreur' : 'Info'}</span>
                  <span className="ml-2">{toast.message}</span>
                </div>
              )}
            </aside>

            <main
              className={[
                'rounded-xl border border-[var(--border)] bg-[var(--social-bg)] shadow-[var(--shadow)]',
                device.isMobile ? 'p-2 sm:p-4' : 'p-4',
                device.isMobile && mode === 'build' && mobileBuildTab !== 'board' ? 'hidden' : '',
              ].join(' ')}
            >
              <div
                className={[
                  'w-full',
                  device.isMobile ? 'max-w-none' : 'mx-auto max-w-[80%]',
                ].join(' ')}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                    {t({ en: 'Board workspace', fr: "Espace échiquier" })}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {!device.isMobile && mode === 'build' ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className={[
                            'counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0 transition-transform active:scale-90',
                          ].join(' ')}
                          style={{
                            color:
                              annotationBrush === 'red'
                                ? '#dc2626'
                                : annotationBrush === 'blue'
                                  ? '#2563eb'
                                  : '#059669',
                          }}
                          onClick={() =>
                            setAnnotationBrush((prev) => {
                              const i = ANNOTATION_BRUSH_CYCLE.indexOf(
                                prev as (typeof ANNOTATION_BRUSH_CYCLE)[number],
                              )
                              return ANNOTATION_BRUSH_CYCLE[i === -1 ? 0 : (i + 1) % ANNOTATION_BRUSH_CYCLE.length]
                            })
                          }
                          title={t({
                            en: 'Annotation color: click to cycle Green -> Red -> Blue.',
                            fr: "Couleur d'annotation : clique pour alterner Vert -> Rouge -> Bleu.",
                          })}
                        >
                          <Circle className="h-4 w-4" fill="currentColor" strokeWidth={1.6} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={[
                            'counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0',
                            annotationTool === 'arrow'
                              ? 'border-red-500 bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-red-300'
                              : '',
                          ].join(' ')}
                          aria-pressed={annotationTool === 'arrow'}
                          onClick={() => setAnnotationTool((tool) => (tool === 'arrow' ? 'none' : 'arrow'))}
                          title={t({
                            en: 'Arrow tool: click source then destination square. Click again to disable.',
                            fr: 'Outil flèche : clique la case de départ puis la case d’arrivée. Reclique pour désactiver.',
                          })}
                        >
                          <ArrowUpRight className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                        </button>
                        <button
                          type="button"
                          className={[
                            'counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0',
                            annotationTool === 'circle'
                              ? 'border-red-500 bg-[var(--accent-bg)] text-[var(--accent)] ring-2 ring-red-300'
                              : '',
                          ].join(' ')}
                          aria-pressed={annotationTool === 'circle'}
                          onClick={() => setAnnotationTool((tool) => (tool === 'circle' ? 'none' : 'circle'))}
                          title={t({
                            en: 'Circle tool: click a square to toggle a circle. Click again to disable.',
                            fr: 'Outil cercle : clique une case pour ajouter/enlever un cercle. Reclique pour désactiver.',
                          })}
                        >
                          <Circle className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                        </button>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="counter mb-0 inline-flex h-7 w-7 flex-shrink-0 items-center justify-center !p-0 leading-none"
                      aria-label={t({ en: 'Board settings', fr: "Paramètres de l'échiquier" })}
                      onClick={() => setSettingsOpen(true)}
                    >
                      <Settings className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                    </button>
                  </div>
                </div>
                <div className="flex items-stretch gap-3">
                  {!device.isMobile && mode === 'build' ? (
                    <div className="w-[10px] shrink-0">
                      <EvalBar eval={positionEval} bottomColor={boardOrientation} className="h-full min-h-0 w-full" />
                    </div>
                  ) : null}
                  <div className="flex-1">
                    <Board
                      fen={currentFen}
                      dests={isAnnotating ? new Map<Key, Key[]>() : boardDests}
                      turnColor={turnColor}
                      orientation={boardOrientation}
                      onMove={isAnnotating ? undefined : onBoardMoveBuild}
                      lastMove={undefined}
                      selectedSquare={annotationTool === 'arrow' ? pendingArrowFrom : null}
                      drawableEnabled={showBoardAnnotations}
                      drawableVisible={showBoardAnnotations && mode === 'build'}
                      shapes={currentShapes}
                      annotationAutoShapes={annotationPreviewAutoShapes}
                      onShapesChange={(next) => {
                        setShapesByFen((prev) => ({ ...prev, [currentFen]: next }))
                      }}
                      annotationMode={isAnnotating}
                      annotateVariant={
                        isAnnotating ? (annotationTool === 'arrow' ? 'arrow' : 'circle') : null
                      }
                      onAnnotateStart={onAnnotateStart}
                      onAnnotateMove={onAnnotateMove}
                      onAnnotateEnd={onAnnotateEnd}
                      touchMoveMode={device.isMobile}
                    />
                  </div>
                </div>
                {!device.isMobile && mode === 'build' ? (
                  <>
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Go to start', fr: 'Revenir au début' })}
                          onClick={() => void goToRoot()}
                        >
                          «
                        </button>
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Previous move', fr: 'Coup précédent' })}
                          onClick={() => void goBack()}
                        >
                          ‹
                        </button>
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Next move', fr: 'Coup suivant' })}
                          onClick={() => void goForward()}
                        >
                          ›
                        </button>
                        <button
                          type="button"
                          className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                          title={t({ en: 'Go to end', fr: 'Aller à la fin' })}
                          onClick={() => void goToEnd()}
                        >
                          »
                        </button>
                      </div>
                    </div>
                  </>
                ) : null}

                {mode === 'build' && device.isMobile ? (
                  <OpeningExplorer
                    fen={currentFen}
                    collapsed={openingExplorerCollapsed}
                    onToggleCollapsed={() => setOpeningExplorerCollapsed((v) => !v)}
                    onPlayMove={(uci) => void onPlayExplorerMove(uci)}
                    stockfishActive={engineBuildOn}
                    stockfishEvaluateFen={engineBuildOn ? stockfishEvaluateFen : undefined}
                  />
                ) : null}
              </div>
            </main>

            {!device.isMobile && mode === 'build' ? (
              <div className="space-y-3">
                <section className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-3 text-left shadow-[var(--shadow)]">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-wide opacity-70">{STOCKFISH_VERSION_LABEL}</div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                        title={t({ en: 'Engine settings', fr: 'Paramètres moteur' })}
                        onClick={() =>
                          setToast({
                            type: 'info',
                            message: t({
                              en: 'Engine settings will be available soon.',
                              fr: 'Les paramètres du moteur seront disponibles bientôt.',
                            }),
                          })
                        }
                      >
                        <Settings className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="counter mb-0 inline-flex h-7 w-7 items-center justify-center !p-0"
                        aria-pressed={engineBuildOn}
                        title={t({ en: 'Engine on/off', fr: 'Moteur on/off' })}
                        onClick={() => setEngineBuildOn((v) => !v)}
                      >
                        <Power className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-end gap-4">
                    {engineBuildOn ? (
                      <div className="text-[36px] font-semibold leading-none tracking-tight text-[var(--text-h)]">
                        {positionEvalBusy ? '…' : formatEval(positionEval)}
                      </div>
                    ) : (
                      <div className="text-[26px] font-semibold leading-none tracking-tight text-[var(--text-h)]">OFF</div>
                    )}
                    <div className="pb-1 text-sm font-semibold opacity-80">
                      {t({ en: 'Depth {depth}', fr: 'Profondeur {depth}' }, { depth: engineBuildOn ? (positionEval?.depth ?? '—') : '—' })}
                    </div>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-[var(--code-bg)]">
                    <div className="h-full w-[72%] rounded-full bg-[var(--text-h)]" />
                  </div>
                  <div className="mt-3 truncate text-sm font-medium text-[var(--text-h)]">
                    {engineBuildOn ? stockfishPvLine : '—'}
                  </div>
                </section>
                <OpeningExplorer
                  fen={currentFen}
                  collapsed={openingExplorerCollapsed}
                  onToggleCollapsed={() => setOpeningExplorerCollapsed((v) => !v)}
                  onPlayMove={(uci) => void onPlayExplorerMove(uci)}
                  stockfishActive={engineBuildOn}
                  stockfishEvaluateFen={engineBuildOn ? stockfishEvaluateFen : undefined}
                />
              </div>
            ) : null}

            {device.isMobile && mode === 'build' ? (
              <nav
                className="fixed bottom-0 left-0 right-0 z-[52] flex gap-1 border-t border-[var(--border)] bg-[var(--bg)]/95 px-2 pt-1.5 backdrop-blur-md pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]"
                role="tablist"
                aria-label="Navigation build"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobileBuildTab === 'tree'}
                  className={[
                    'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] font-medium transition-colors',
                    mobileBuildTab === 'tree'
                      ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'text-[var(--text)] opacity-80 hover:bg-[var(--code-bg)]',
                  ].join(' ')}
                  onClick={() => setMobileBuildTab('tree')}
                >
                  <ListTree className="h-5 w-5" strokeWidth={2} aria-hidden />
                  {t({ en: 'Tree', fr: 'Arbre' })}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mobileBuildTab === 'board'}
                  className={[
                    'flex flex-1 flex-col items-center gap-0.5 rounded-lg py-2 text-[11px] font-medium transition-colors',
                    mobileBuildTab === 'board'
                      ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                      : 'text-[var(--text)] opacity-80 hover:bg-[var(--code-bg)]',
                  ].join(' ')}
                  onClick={() => setMobileBuildTab('board')}
                >
                  <LayoutGrid className="h-5 w-5" strokeWidth={2} aria-hidden />
                  {t({ en: 'Board', fr: 'Échiquier' })}
                </button>
              </nav>
            ) : null}
          </div>
          )}
        </>
      )}

      {modal?.kind === 'puzzleStart' ? (
        <ModalFrame
          title={t({ en: 'Puzzles linked to repertoire', fr: 'Puzzles liés au répertoire' })}
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setModal(null)}>
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button
                type="button"
                className="counter"
                disabled={puzzleLoading || !modal.hasSelection || puzzleStartTagsDraft.length === 0}
                onClick={() =>
                  void loadPuzzleQueue({
                    openingTags: puzzleStartTagsDraft,
                  })
                }
              >
                {t({ en: 'Start', fr: 'Démarrer' })}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">
                {t({ en: 'Current position preview', fr: 'Aperçu de la position actuelle' })}
              </div>
              <div className="mx-auto w-full max-w-[210px]">
                <Board
                  fen={currentFen}
                  dests={new Map()}
                  showDests={false}
                  turnColor={puzzleStartPreviewTurnColor}
                  orientation={boardOrientation}
                  drawableEnabled={false}
                  drawableVisible={false}
                  shapes={[]}
                  annotationAutoShapes={[]}
                  annotationMode={false}
                  touchMoveMode={device.isMobile}
                />
              </div>
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--bg)] p-2 text-xs">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide opacity-70">{t({ en: 'Detected openings', fr: 'Ouvertures détectées' })}</div>
              {puzzleStartTagsDraft.length === 0 ? (
                <div className="opacity-70">{puzzleLoading ? t({ en: 'Analyzing…', fr: 'Analyse…' }) : t({ en: 'No tag detected.', fr: 'Aucun tag détecté.' })}</div>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {puzzleStartTagsDraft
                    .slice()
                    .sort((a, b) => a.localeCompare(b))
                    .map((tag) => (
                      <span
                        key={tag}
                        className="rounded border border-[var(--accent-border)] bg-[var(--accent-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--accent)]"
                      >
                        {tag}
                      </span>
                    ))}
                </div>
              )}
            </div>

            {!modal.hasSelection ? (
              <div className="text-xs opacity-80">
                {t({ en: 'Select a position in the tree before launching puzzles.', fr: "Sélectionne une position dans l'arbre avant de lancer les puzzles." })}
              </div>
            ) : null}
            {puzzleLoading ? <div className="text-xs opacity-80">{t({ en: 'Opening analysis…', fr: 'Analyse des ouvertures…' })}</div> : null}
          </div>
        </ModalFrame>
      ) : null}

      {modal?.kind === 'trainStart' ? (
        <ModalFrame
          title={t({ en: 'Start training', fr: 'Démarrer un entraînement' })}
          onClose={() => setModal(null)}
          actions={
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="counter"
                disabled={modal.fullCount === 0}
                onClick={() => {
                  setModal(null)
                  void startTrainRun({ kind: 'full' })
                }}
              >
                {t({ en: 'Full repertoire', fr: 'Tout le répertoire' })}
              </button>
              <button
                type="button"
                className="counter"
                disabled={!modal.hasSelection || currentNodeId == null || modal.selectionCount === 0}
                onClick={() => {
                  setModal(null)
                  void startTrainRun({
                    kind: 'selection',
                    positions: selectionTrainPositions,
                    scopeRootId: currentNodeId,
                  })
                }}
              >
                {t({ en: 'Selected variation', fr: 'Variante sélectionnée' })}
              </button>
              <button
                type="button"
                className="counter"
                disabled={modal.fullCount === 0}
                onClick={() => {
                  setModal({
                    kind: 'trainRandomConfig',
                    maxCount: modal.fullCount,
                    hasSelection: modal.hasSelection,
                    selectionMaxCount: modal.selectionCount,
                  })
                  setRandomScopeSelected(false)
                  setRandomCountDraft(Math.min(10, modal.fullCount))
                }}
              >
                {t({ en: 'Random positions', fr: 'Positions aléatoires' })}
              </button>
              <button
                type="button"
                className="counter"
                disabled={
                  modal.fullCount === 0 ||
                  fsrsQueuePreviewCount === null ||
                  fsrsQueuePreviewCount === 0
                }
                onClick={() => {
                  if (!activeRepertoireId) return
                  void (async () => {
                    const q = await buildFsrsTrainQueue(activeRepertoireId, trainPositions)
                    if (q.length === 0) {
                      setToast({ type: 'info', message: t({ en: 'No position in FSRS queue for now.', fr: 'Aucune position dans la file FSRS pour le moment.' }) })
                      return
                    }
                    setModal(null)
                    void startTrainRun({ kind: 'fsrs', positions: q })
                  })()
                }}
              >
                FSRS
                {fsrsQueuePreviewCount != null ? (
                  <span className="ml-1 font-mono text-[11px] opacity-90">({fsrsQueuePreviewCount})</span>
                ) : (
                  <span className="ml-1 font-mono text-[11px] opacity-60">(…)</span>
                )}
              </button>
            </div>
          }
        >
          <div className="space-y-2 text-sm">
            <div>
              {t({ en: 'Full repertoire', fr: 'Répertoire complet' })}: <span className="font-mono">{modal.fullCount}</span> {t({ en: 'positions', fr: 'positions' })}.
            </div>
            <div>
              {t({ en: 'Selected variation', fr: 'Variante sélectionnée' })}: <span className="font-mono">{modal.selectionCount}</span> {t({ en: 'positions', fr: 'positions' })}.
            </div>
            <div className="text-[var(--text)] opacity-90">
              <span className="font-medium text-[var(--text-h)]">FSRS</span> : {t({
                en: 'due positions + new positions every day (quota increases day by day). Algorithm',
                fr: 'positions dues + nouvelles positions chaque jour (quota qui augmente jour après jour). Algorithme',
              })}{' '}
              <span className="font-mono text-[11px]">ts-fsrs</span>.
            </div>
          </div>
          {!modal.hasSelection ? (
            <div className="mt-2 text-sm opacity-80">
              {t({ en: 'Select a move in the tree to train only this variation.', fr: "Sélectionne un coup dans l'arbre pour entraîner uniquement cette variante." })}
            </div>
          ) : null}
          {modal.fullCount === 0 ? (
            <div className="mt-2 text-sm opacity-80">{t({ en: 'No trainable position found.', fr: 'Aucune position entraînable trouvée.' })}</div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
            <span className="text-[var(--text-h)]">{t({ en: 'Train main line only (your color)', fr: 'Entraîner la ligne principale seulement (ta couleur)' })}</span>
            <button
              type="button"
              className={['toggle-switch', trainMainLineOnly ? 'is-on' : ''].join(' ')}
              role="switch"
              aria-checked={trainMainLineOnly}
              onClick={() => setTrainMainLineOnly((v) => !v)}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </ModalFrame>
      ) : null}

      {modal?.kind === 'trainRandomConfig' ? (
        <ModalFrame
          title={t({ en: 'Random positions', fr: 'Positions aléatoires' })}
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setModal(null)}>
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button
                type="button"
                className="counter"
                disabled={
                  (randomScopeSelected ? modal.selectionMaxCount : modal.maxCount) === 0 ||
                  randomCountDraft <= 0
                }
                onClick={() => {
                  const max = randomScopeSelected ? modal.selectionMaxCount : modal.maxCount
                  const n = Math.max(1, Math.min(randomCountDraft, max))
                  setModal(null)
                  void startRandomTrainRun({ count: n, scopeSelection: randomScopeSelected })
                }}
              >
                {t({ en: 'Start', fr: 'Démarrer' })}
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <div>
              {t({ en: 'Number of positions (max', fr: 'Nombre de positions (max' })}{' '}
              <span className="font-mono">{randomScopeSelected ? modal.selectionMaxCount : modal.maxCount}</span>)
            </div>
            <input
              type="number"
              min={1}
              max={randomScopeSelected ? modal.selectionMaxCount : modal.maxCount}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono"
              value={randomCountDraft}
              onChange={(e) => setRandomCountDraft(Number(e.target.value))}
            />

            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--text-h)]">{t({ en: 'Focus on selected variation', fr: 'Se concentrer sur la variante sélectionnée' })}</span>
              <button
                type="button"
                className={`toggle-switch ${randomScopeSelected ? 'is-on' : ''}`}
                role="switch"
                aria-checked={randomScopeSelected}
                disabled={!modal.hasSelection}
                onClick={() => {
                  if (!modal.hasSelection) return
                  setRandomScopeSelected((v) => !v)
                }}
                title={!modal.hasSelection ? t({ en: 'Select a move in tree to enable.', fr: 'Sélectionne un coup dans l’arbre pour activer.' }) : ''}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
            {!modal.hasSelection ? (
              <div className="text-xs opacity-80">{t({ en: 'Select a move in tree to enable this mode.', fr: 'Sélectionne un coup dans l’arbre pour activer ce mode.' })}</div>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
              <span className="text-[var(--text-h)]">{t({ en: 'Train main line only (your color)', fr: 'Entraîner la ligne principale seulement (ta couleur)' })}</span>
              <button
                type="button"
                className={['toggle-switch', trainMainLineOnly ? 'is-on' : ''].join(' ')}
                role="switch"
                aria-checked={trainMainLineOnly}
                onClick={() => setTrainMainLineOnly((v) => !v)}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
          </div>
        </ModalFrame>
      ) : null}

      {modal?.kind === 'trainSummary' ? (
        <ModalFrame
          title={t({ en: 'Run summary', fr: 'Résumé du run' })}
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                className="counter"
                disabled={modal.failed === 0 || modal.failedPositions.length === 0}
                onClick={() => {
                  if (modal.failed === 0 || modal.failedPositions.length === 0) return
                  setModal(null)
                  void startTrainRun({ kind: 'failed', positions: modal.failedPositions })
                }}
              >
                {t({ en: 'Replay failed', fr: 'Rejouer les échouées' })}
              </button>
              <button
                type="button"
                className="counter"
                onClick={() => {
                  setModal(null)
                  void startTrainRun({ kind: 'full' })
                }}
              >
                New run
              </button>
            </div>
          }
        >
          <SummaryBlock
            total={modal.totalPositions}
            passed={modal.passed}
            failed={modal.failed}
          />
        </ModalFrame>
      ) : null}

      {modal?.kind === 'confirmDeleteRepertoire' ? (
        <ModalFrame
          title={t({ en: 'Delete repertoire', fr: 'Supprimer le répertoire' })}
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setModal(null)}>
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button
                type="button"
                className="counter"
                onClick={() => {
                  if (modal?.kind !== 'confirmDeleteRepertoire') return
                  const rep = modal.repertoire
                  setModal(null)
                  void (async () => {
                    setBusy(true)
                    setToast(null)
                    try {
                      await deleteRepertoire(rep.id)
                      const reps = await refreshRepertoireOverview()
                      if (activeRepertoireId === rep.id) {
                        setActiveRepertoireId(reps[0]?.id ?? null)
                        setView('home')
                      }
                      if (shareTarget?.id === rep.id) setShareTarget(null)
                      if (renameTarget?.id === rep.id) setRenameTarget(null)
                    } catch {
                      setToast({ type: 'error', message: t({ en: 'Unable to delete this repertoire.', fr: 'Impossible de supprimer ce répertoire.' }) })
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                {t({ en: 'Delete', fr: 'Supprimer' })}
              </button>
            </div>
          }
        >
          <div className="text-sm">
            {t({ en: 'Delete permanently', fr: 'Supprimer définitivement' })}{' '}
            <span className="font-medium">{modal.repertoire.title}</span> {t({ en: 'and all its positions?', fr: 'et toutes ses positions ?' })}
          </div>
        </ModalFrame>
      ) : null}

      {modal?.kind === 'confirmDeleteMove' ? (
        <ModalFrame
          title={t({ en: 'Confirm delete', fr: 'Confirmer la suppression' })}
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setModal(null)}>
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button
                type="button"
                className="counter"
                onClick={() => {
                  if (modal?.kind !== 'confirmDeleteMove') return
                  const move = modal.move
                  const rootMoveId = move.id
                  if (!activeRepertoireId || !rootMoveId) return
                  setModal(null)
                  void (async () => {
                    setBusy(true)
                    setToast(null)
                    try {
                      await deleteMoveSubtree({ repertoireId: activeRepertoireId, rootMoveId })
                      await refreshAllMoves(activeRepertoireId)
                      await refreshRepertoireOverview()

                      const isInPath = path.some((m) => m.id === move.id)
                      if (isInPath) {
                        const nextPath = move.parentId == null ? [] : truncatePathToNodeId(move.parentId)
                        setPath(nextPath)
                        const nextNodeId = nextPath.length ? nextPath[nextPath.length - 1]!.id : null
                        setCurrentNodeId(nextNodeId)
                        await refreshChildren(activeRepertoireId, move.parentId)
                      } else {
                        await refreshChildren(activeRepertoireId, currentNodeId)
                      }
                    } catch {
                      setToast({ type: 'error', message: t({ en: 'Unable to delete this variation.', fr: 'Impossible de supprimer cette variante.' }) })
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                {t({ en: 'Delete', fr: 'Supprimer' })}
              </button>
            </div>
          }
        >
          <div className="text-sm">
            {t({ en: 'Delete', fr: 'Supprimer' })} <span className="font-mono">{modal.move.notation}</span>{' '}
            {t({ en: 'and all its sub-variation?', fr: 'et toute sa sous-variante ?' })}
          </div>
        </ModalFrame>
      ) : null}

      {renameTarget ? (
        <ModalFrame
          title={t({ en: 'Rename repertoire', fr: 'Renommer le répertoire' })}
          onClose={() => setRenameTarget(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setRenameTarget(null)}>
                {t({ en: 'Cancel', fr: 'Annuler' })}
              </button>
              <button
                type="button"
                className="counter"
                disabled={!renameDraft.trim()}
                onClick={() => {
                  const nextTitle = renameDraft.trim().slice(0, 80)
                  if (!nextTitle || !renameTarget) return
                  const nextDescription = renameDescriptionDraft.trim().slice(0, 140)
                  void (async () => {
                    setBusy(true)
                    setToast(null)
                    try {
                      await updateRepertoireMetadata(renameTarget.id, {
                        title: nextTitle,
                        description: nextDescription || undefined,
                      })
                      await refreshRepertoireOverview()
                      if (activeRepertoireId === renameTarget.id) {
                        const rep = await getRepertoire(renameTarget.id)
                        setActiveRepertoire(rep ?? null)
                      }
                      setRenameTarget(null)
                    } catch {
                      setToast({ type: 'error', message: t({ en: 'Unable to rename repertoire.', fr: 'Impossible de renommer le répertoire.' }) })
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                {t({ en: 'Save', fr: 'Enregistrer' })}
              </button>
            </div>
          }
        >
          <label className="block text-sm text-[var(--text-h)]" htmlFor="rename-rep-title">
            {t({ en: 'Name', fr: 'Nom' })}
          </label>
          <input
            id="rename-rep-title"
            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            maxLength={80}
            autoFocus
          />
          <label className="mt-3 block text-sm text-[var(--text-h)]" htmlFor="rename-rep-description">
            {t({ en: 'Subtitle', fr: 'Sous-titre' })}
          </label>
          <input
            id="rename-rep-description"
            className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm italic"
            value={renameDescriptionDraft}
            onChange={(e) => setRenameDescriptionDraft(e.target.value)}
            maxLength={140}
            placeholder={t({ en: 'Optional short description', fr: 'Description courte optionnelle' })}
          />
        </ModalFrame>
      ) : null}

      {settingsOpen ? (
        <SettingsPopup
          fen={currentFen}
          flipBoard={flipBoard}
          showDests={showDests}
          showBoardAnnotations={showBoardAnnotations}
          showAnnotationsToggle={mode === 'build'}
          animationSpeed={playbackSettings.animationSpeed}
          replayMoves={playbackSettings.replayMoves}
          soundOn={playbackSettings.soundOn}
          notificationsEnabled={activeRepertoire?.notificationsEnabled === true}
          notificationsSupported={notificationsSupported}
          visualTheme={visualTheme}
          onClose={() => setSettingsOpen(false)}
          onCopyFen={() => void navigator.clipboard.writeText(currentFen)}
          onToggleFlip={() => setFlipBoard((v) => !v)}
          onToggleDests={() => setShowDests((v) => !v)}
          onToggleAnnotations={() => setShowBoardAnnotations((v) => !v)}
          onChangeAnimationSpeed={(animationSpeed) => setPlaybackSettings((prev) => ({ ...prev, animationSpeed }))}
          onToggleReplayMoves={() => setPlaybackSettings((prev) => ({ ...prev, replayMoves: !prev.replayMoves }))}
          onToggleSound={() => setPlaybackSettings((prev) => ({ ...prev, soundOn: !prev.soundOn }))}
          onToggleNotifications={toggleRepertoireNotifications}
          onChangeVisualTheme={(nextTheme) => setVisualTheme(nextTheme)}
        />
      ) : null}

      <CreateRepertoireModal
        open={createRepertoireOpen}
        busy={busy}
        onClose={() => setCreateRepertoireOpen(false)}
        onSubmit={async (title, side, description) => {
          const ok = await handleCreate(title, side, description)
          if (ok) setView('session')
          return ok
        }}
      />
      <ImportRepertoireModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={(id) => {
          void (async () => {
            await refreshRepertoireOverview()
            setActiveRepertoireId(id)
            setMode('build')
            setView('session')
            setImportOpen(false)
          })()
        }}
      />
      <ShareRepertoireModal
        open={shareTarget != null}
        repertoireId={shareTarget?.id ?? ''}
        repertoireTitle={shareTarget?.title ?? ''}
        onClose={() => setShareTarget(null)}
      />
    </div>
  )
}

function ModalFrame({
  title,
  children,
  actions,
  onClose,
}: {
  title: string
  children: React.ReactNode
  actions: React.ReactNode
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 md:bottom-0 md:left-[208px] md:right-0 md:top-[74px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-[520px] rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4 shadow-[var(--shadow)]">
        <div className="flex items-start justify-between gap-3">
          <div className="text-sm font-medium text-[var(--text-h)]">{title}</div>
          <button
            type="button"
            className="rounded px-2 py-1 text-sm hover:bg-[var(--accent-bg)]"
            onClick={onClose}
            aria-label={t({ en: 'Close', fr: 'Fermer' })}
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
        <div className="mt-4 flex justify-end gap-4">{actions}</div>
      </div>
    </div>
  )
}

function SummaryBlock({ total, passed, failed }: { total: number; passed: number; failed: number }) {
  const { t } = useI18n()
  const played = total
  const success = Math.max(0, total - failed)
  const pct = total === 0 ? 0 : Math.round((success / total) * 100)
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">{t({ en: 'Positions played', fr: 'Positions jouées' })}</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{played}</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">{t({ en: 'Success', fr: 'Réussite' })}</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{pct}%</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">{t({ en: 'Passed', fr: 'Passées' })}</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{passed}</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">Fails</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{failed}</div>
      </div>
    </div>
  )
}

function PuzzleSessionTimer({ startedAtMs, averageMs }: { startedAtMs: number | null; averageMs: number }) {
  const { t } = useI18n()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    setNowMs(Date.now())
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [startedAtMs])

  const elapsed = startedAtMs == null ? 0 : Math.max(0, nowMs - startedAtMs)
  return (
    <div className="mt-1.5 text-left text-[10px] opacity-80">
      {t({ en: 'Puzzle time', fr: 'Temps puzzle' })}: <span className="font-mono">{formatDurationMs(elapsed)}</span>
      <span className="mx-1.5">·</span>
      {t({ en: 'Session average', fr: 'Moyenne session' })}: <span className="font-mono">{formatDurationMs(averageMs)}</span>
    </div>
  )
}

function SettingsPopup({
  fen,
  flipBoard,
  showDests,
  showBoardAnnotations,
  showAnnotationsToggle,
  animationSpeed,
  replayMoves,
  soundOn,
  notificationsEnabled,
  notificationsSupported,
  visualTheme,
  onClose,
  onCopyFen,
  onToggleFlip,
  onToggleDests,
  onToggleAnnotations,
  onChangeAnimationSpeed,
  onToggleReplayMoves,
  onToggleSound,
  onToggleNotifications,
  onChangeVisualTheme,
}: {
  fen: string
  flipBoard: boolean
  showDests: boolean
  showBoardAnnotations: boolean
  showAnnotationsToggle: boolean
  animationSpeed: AnimationSpeed
  replayMoves: boolean
  soundOn: boolean
  notificationsEnabled: boolean
  notificationsSupported: boolean
  visualTheme: VisualTheme
  onClose: () => void
  onCopyFen: () => void
  onToggleFlip: () => void
  onToggleDests: () => void
  onToggleAnnotations: () => void
  onChangeAnimationSpeed: (speed: AnimationSpeed) => void
  onToggleReplayMoves: () => void
  onToggleSound: () => void
  onToggleNotifications: () => void
  onChangeVisualTheme: (theme: VisualTheme) => void
}) {
  const { t } = useI18n()
  return (
    <ModalFrame
      title={t({ en: 'Settings', fr: 'Paramètres' })}
      onClose={onClose}
      actions={<button type="button" className="counter" onClick={onClose}>OK</button>}
    >
      <div className="space-y-4 text-left text-sm">
        <ToggleRow label={t({ en: 'Flip board', fr: "Inverser l'échiquier" })} checked={flipBoard} onChange={onToggleFlip} />
        <ToggleRow label={t({ en: 'Show destinations', fr: 'Afficher les destinations' })} checked={showDests} onChange={onToggleDests} />
        <div className="space-y-2">
          <div className="text-[var(--text-h)]">{t({ en: 'Animation speed', fr: "Vitesse d'animation" })}</div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['very_fast', t({ en: 'Very fast', fr: 'Très rapide' })],
                ['fast', t({ en: 'Fast', fr: 'Rapide' })],
                ['medium', t({ en: 'Medium', fr: 'Moyenne' })],
                ['slow', t({ en: 'Slow', fr: 'Lente' })],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={[
                  'rounded border px-2 py-1 text-xs transition-colors',
                  animationSpeed === id
                    ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--code-bg)]',
                ].join(' ')}
                onClick={() => onChangeAnimationSpeed(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <div className="text-[var(--text-h)]">{t({ en: 'Visual theme', fr: 'Thème visuel' })}</div>
          <div className="flex flex-wrap gap-1.5">
            {(
              [
                ['soft_pro', t({ en: 'Soft Pro (Lumina Gambit)', fr: 'Soft Pro (Lumina Gambit)' })],
                ['high_contrast', t({ en: 'High Contrast (Analytical Monolith)', fr: 'High Contrast (Analytical Monolith)' })],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={[
                  'rounded border px-2 py-1 text-xs transition-colors',
                  visualTheme === id
                    ? 'border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]'
                    : 'border-[var(--border)] bg-[var(--bg)] text-[var(--text)] hover:bg-[var(--code-bg)]',
                ].join(' ')}
                onClick={() => onChangeVisualTheme(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <ToggleRow label={t({ en: 'Replay moves', fr: 'Rejouer les coups' })} checked={replayMoves} onChange={onToggleReplayMoves} />
        <ToggleRow label={t({ en: 'Sound on / off', fr: 'Son on / off' })} checked={soundOn} onChange={onToggleSound} />
        <ToggleRow
          label={t({ en: 'Daily reminders (FSRS + 48h)', fr: 'Rappels quotidiens (FSRS + 48h)' })}
          checked={notificationsEnabled}
          onChange={onToggleNotifications}
          disabled={!notificationsSupported}
        />
        {!notificationsSupported ? (
          <div className="text-xs opacity-75">
            {t(
              {
                en: 'Notifications are not supported on this device/browser.',
                fr: 'Les notifications ne sont pas supportées sur cet appareil/navigateur.',
              },
            )}
          </div>
        ) : null}
        {showAnnotationsToggle ? (
          <ToggleRow
            label={t({ en: 'Show annotations', fr: 'Afficher annotations' })}
            checked={showBoardAnnotations}
            onChange={onToggleAnnotations}
          />
        ) : null}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[var(--text-h)]">FEN</span>
            <button type="button" className="counter text-xs" onClick={onCopyFen}>
              {t({ en: 'Copy FEN', fr: 'Copier FEN' })}
            </button>
          </div>
          <div className="break-all rounded-md bg-[var(--code-bg)] px-3 py-2 font-mono text-sm text-[var(--text-h)]">
            {fen}
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled = false,
}: {
  label: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--text-h)]">{label}</span>
      <button
        type="button"
        className={`toggle-switch ${checked ? 'is-on' : ''}`}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={onChange}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  )
}

function RepertoirePreviewBoard({
  fen,
  orientation,
  sizeClassName,
}: {
  fen: string
  orientation: 'white' | 'black'
  sizeClassName: string
}) {
  return (
    <div className={['repertoire-preview pointer-events-none overflow-hidden rounded-md', sizeClassName].join(' ')}>
      <Board
        fen={fen}
        dests={EMPTY_DESTS}
        turnColor="white"
        orientation={orientation}
        showCoordinates={false}
        showDests={false}
        touchMoveMode
      />
    </div>
  )
}

function HomeSection({
  title,
  sectionColorDot,
  repertoires,
  repertoireCounts,
  onOpen,
  onExportPgn,
  onShare,
  onRename,
  onDelete,
}: {
  title: string
  sectionColorDot: 'white' | 'black'
  repertoires: Repertoire[]
  repertoireCounts: RepertoireCounts
  onOpen: (id: string) => void
  onExportPgn: (id: string) => void | Promise<void>
  onShare: (id: string, title: string) => void
  onRename: (repertoire: Repertoire) => void
  onDelete: (repertoire: Repertoire) => void
}) {
  const { t } = useI18n()
  return (
    <section>
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-h)]">
        <span
          className={[
            'h-2 w-2 shrink-0 rounded-full border',
            sectionColorDot === 'white'
              ? 'border-neutral-400 bg-white shadow-sm'
              : 'border-neutral-800 bg-neutral-900 dark:border-neutral-600 dark:bg-neutral-950',
          ].join(' ')}
          aria-hidden
        />
        <span>{title}</span>
      </div>
      <div className="mt-3 space-y-2">
        {repertoires.length === 0 ? (
          <div className="text-sm opacity-80">{t({ en: 'No repertoire.', fr: 'Aucun répertoire.' })}</div>
        ) : (
          repertoires.map((r) => (
            <div
              key={r.id}
              className="flex min-w-0 items-stretch gap-0 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--bg)] hover:shadow-[var(--shadow)]"
            >
              {/* 1 — titre + sous-titre (prend l’espace horizontal disponible) */}
              <div
                className="flex min-w-0 flex-1 cursor-pointer flex-col px-3 py-2 text-left"
                role="button"
                tabIndex={0}
                onClick={() => onOpen(r.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onOpen(r.id)
                }}
                aria-label={t({ en: 'Open {title}', fr: 'Ouvrir {title}' }, { title: r.title })}
              >
                <div className="min-w-0 truncate text-left text-sm font-medium text-[var(--text-h)]">
                  {r.title}
                </div>
                {r.description ? <div className="truncate text-xs italic opacity-70">{r.description}</div> : null}
                <div className="mt-0.5 w-full text-left text-xs opacity-80 hover:opacity-100">
                  {t({ en: '{count} saved positions', fr: '{count} positions enregistrées' }, { count: repertoireCounts[r.id] ?? 0 })}
                </div>
              </div>
              {/* 2 — flamme seule, centrée verticalement */}
              <div
                className={[
                  'flex shrink-0 items-center justify-center',
                  r.trainStreak != null && r.trainStreak > 0 ? 'min-w-[2.25rem] px-1' : 'w-0 min-w-0 overflow-hidden p-0',
                ].join(' ')}
              >
                {r.trainStreak != null && r.trainStreak > 0 ? (
                  <span
                    className="relative inline-flex h-8 w-7 shrink-0 items-end justify-center text-[var(--accent)]"
                    title={t({ en: 'Streak: {count} day(s) in a row', fr: 'Série : {count} jour(s) consécutif(s)' }, { count: r.trainStreak })}
                  >
                    <Flame className="h-8 w-8 shrink-0" fill="currentColor" stroke="none" aria-hidden />
                    <span className="pointer-events-none absolute bottom-[5px] left-1/2 -translate-x-1/2 text-[10px] font-bold leading-none text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.55)] tabular-nums">
                      {r.trainStreak}
                    </span>
                  </span>
                ) : null}
              </div>
              {/* 3 — renommer / supprimer, alignés en haut */}
              <div className="flex shrink-0 flex-row items-start gap-0.5 self-start pl-2 pr-3 pt-2.5">
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                  aria-label={t({ en: 'Rename {title}', fr: 'Renommer {title}' }, { title: r.title })}
                  title={t({ en: 'Rename', fr: 'Renommer' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onRename(r)
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-red-500/15 hover:text-red-600 hover:opacity-100 dark:hover:text-red-400"
                  aria-label={t({ en: 'Delete {title}', fr: 'Supprimer {title}' }, { title: r.title })}
                  title={t({ en: 'Delete repertoire', fr: 'Supprimer le répertoire' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(r)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
              {/* 4 — télécharger / partager */}
              <div className="flex shrink-0 flex-col justify-center gap-0.5 border-l border-[var(--border)] px-0.5 py-1">
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                  aria-label={t({ en: 'Download {title} as PGN', fr: 'Télécharger {title} en PGN' }, { title: r.title })}
                  title={t({ en: 'Download PGN', fr: 'Télécharger PGN' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    void onExportPgn(r.id)
                  }}
                >
                  <Download className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] opacity-70 hover:bg-[var(--accent-bg)] hover:text-[var(--accent)] hover:opacity-100"
                  aria-label={t({ en: 'Share {title}', fr: 'Partager {title}' }, { title: r.title })}
                  title={t({ en: 'Share', fr: 'Partager' })}
                  onClick={(e) => {
                    e.stopPropagation()
                    onShare(r.id, r.title)
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

function CreateRepertoireModal({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (title: string, side: Side, description?: string) => Promise<boolean>
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [side, setSide] = useState<Side>('white')

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setSide('white')
  }, [open])

  if (!open) return null

  return (
    <ModalFrame
      title={t({ en: 'Create repertoire', fr: 'Créer un répertoire' })}
      onClose={() => {
        if (!busy) onClose()
      }}
      actions={
        <>
          <button type="button" className="counter" disabled={busy} onClick={onClose}>
            {t({ en: 'Cancel', fr: 'Annuler' })}
          </button>
          <button
            type="button"
            className="counter"
            disabled={busy || !title.trim()}
            onClick={() => {
              void (async () => {
                const ok = await onSubmit(title.trim(), side, description.trim() || undefined)
                if (ok) onClose()
              })()
            }}
          >
            {t({ en: 'Create', fr: 'Créer' })}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-left text-sm text-[var(--text-h)]">
        <div>
          <label className="block text-xs font-medium opacity-90" htmlFor="create-rep-title">
            {t({ en: 'Title', fr: 'Titre' })}
          </label>
          <input
            id="create-rep-title"
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t({ en: 'My opening…', fr: 'Mon ouverture…' })}
            maxLength={80}
            disabled={busy}
            autoFocus
          />
        </div>
        <div>
          <label className="block text-xs font-medium opacity-90" htmlFor="create-rep-description">
            {t({ en: 'Short description', fr: 'Description courte' })}
          </label>
          <input
            id="create-rep-description"
            className="mt-1.5 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm italic"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t({ en: 'e.g. Practical anti-Sicilian lines', fr: 'ex : Lignes pratiques anti-Sicilienne' })}
            maxLength={140}
            disabled={busy}
          />
        </div>
        <div>
          <span className="block text-xs font-medium opacity-90">{t({ en: 'Repertoire color', fr: 'Couleur du répertoire' })}</span>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              className={[
                'counter flex items-center gap-2 !py-2',
                side === 'white' ? 'border-[var(--accent)] bg-[var(--accent-bg)]' : '',
              ].join(' ')}
              disabled={busy}
              onClick={() => setSide('white')}
            >
              <span className="h-2.5 w-2.5 rounded-full border border-neutral-400 bg-white shadow-sm" aria-hidden />
              {t({ en: 'White', fr: 'Blancs' })}
            </button>
            <button
              type="button"
              className={[
                'counter flex items-center gap-2 !py-2',
                side === 'black' ? 'border-[var(--accent)] bg-[var(--accent-bg)]' : '',
              ].join(' ')}
              disabled={busy}
              onClick={() => setSide('black')}
            >
              <span
                className="h-2.5 w-2.5 rounded-full border border-neutral-800 bg-neutral-900 dark:border-neutral-600 dark:bg-neutral-950"
                aria-hidden
              />
              {t({ en: 'Black', fr: 'Noirs' })}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  )
}


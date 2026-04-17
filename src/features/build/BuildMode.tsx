import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chess } from 'chess.js'
import type { Key } from 'chessground/types'
import type { DrawShape } from 'chessground/draw'

import { Board } from '../../components/Board'
import { computeDests } from '../../chess/computeDests'
import { buildMoveForest, pathToIdSet } from '../../chess/moveTree'
import type { Move, Repertoire, Side } from '../../db/schema'
import {
  addMove,
  createRepertoire,
  deleteMoveSubtree,
  getRepertoire,
  listChildrenMoves,
  listAllMoves,
  listRepertoires,
  updateMove,
} from '../../db/repertoireRepo'
import { getSupabaseClient } from '../../lib/supabaseClient'
import { MoveTreeView } from './MoveTreeView'
import { OpeningExplorer } from './OpeningExplorer'

type Toast = { type: 'info' | 'error'; message: string } | null
type Mode = 'build' | 'train'
type TrainRunKind = 'full' | 'selection' | 'failed' | 'random'
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
  | { kind: 'confirmDeleteMove'; move: Move }
  | null

type View = 'home' | 'session'
type RepertoireCounts = Record<string, number>
type AnnotationTool = 'none' | 'arrow' | 'circle'
type AnnotationBrush = NonNullable<DrawShape['brush']>

function sideToTurn(side: Side): 'w' | 'b' {
  return side === 'white' ? 'w' : 'b'
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

export function BuildMode() {
  const [view, setView] = useState<View>('home')
  const [repertoires, setRepertoires] = useState<Repertoire[]>([])
  const [repertoireCounts, setRepertoireCounts] = useState<RepertoireCounts>({})
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
  const [flipBoard, setFlipBoard] = useState(false)
  const [showDests, setShowDests] = useState(true)
  const [showBoardAnnotations, setShowBoardAnnotations] = useState(true)
  const [shapesByFen, setShapesByFen] = useState<Record<string, DrawShape[]>>({})
  const [annotationTool, setAnnotationTool] = useState<AnnotationTool>('none')
  const [annotationBrush, setAnnotationBrush] = useState<AnnotationBrush>('green')
  const [pendingArrowFrom, setPendingArrowFrom] = useState<Key | null>(null)
  const [openingExplorerCollapsed, setOpeningExplorerCollapsed] = useState(false)
  const exploredByParentRef = useRef<Map<string | null, Set<string>>>(new Map())
  const [modal, setModal] = useState<Modal>(null)

  const [trainRunActive, setTrainRunActive] = useState(false)
  const [trainRunKind, setTrainRunKind] = useState<TrainRunKind>('full')
  const [trainScopeRootId, setTrainScopeRootId] = useState<string | null>(null)
  const passedPositionsRef = useRef<Set<string | null>>(new Set())
  const failedPositionsRef = useRef<Set<string | null>>(new Set())
  const [trainRunPositions, setTrainRunPositions] = useState<Array<string | null> | null>(null)
  const [trainRunIndex, setTrainRunIndex] = useState(0)
  const [trainPassed, setTrainPassed] = useState(0)
  const [trainFailed, setTrainFailed] = useState(0)
  const [trainCombo, setTrainCombo] = useState(0)
  const [trainDepthBase, setTrainDepthBase] = useState(0)
  const [trainMissPulse, setTrainMissPulse] = useState(false)
  const [hintStep, setHintStep] = useState<0 | 1 | 2>(0)
  const [replayingSequence, setReplayingSequence] = useState(false)
  const lastTrainQuestionKeyRef = useRef<string | null | 'none'>('none')
  const [randomCountDraft, setRandomCountDraft] = useState(10)
  const [randomScopeSelected, setRandomScopeSelected] = useState(false)

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

    const byId = new Map<string, Move>()
    for (const m of allMoves) byId.set(m.id, m)

    const childrenByParent = new Map<string | null, Move[]>()
    for (const m of allMoves) {
      const key = m.parentId ?? null
      const list = childrenByParent.get(key)
      if (list) list.push(m)
      else childrenByParent.set(key, [m])
    }

    const parents = [...childrenByParent.keys()]
    const out: Array<string | null> = []
    for (const parentId of parents) {
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
      if (c.turn() === sideToTurn(activeRepertoire.side)) out.push(parentId)
    }
    return out
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
  const hintMoveKeys = useMemo(() => {
    if (mode !== 'train') return null
    if (!isUsersTurn) return null
    const first = children[0]
    if (!first) return null

    const c = new Chess()
    try {
      c.load(currentFen)
      const move = c.move(first.notation)
      if (!move) return null
      return { from: move.from as Key, to: move.to as Key }
    } catch {
      return null
    }
  }, [children, currentFen, isUsersTurn, mode])
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
  const currentShapes = shapesByFen[currentFen] ?? []
  const isAnnotating = mode === 'build' && annotationTool !== 'none'
  const whiteRepertoires = useMemo(() => repertoires.filter((r) => r.side === 'white'), [repertoires])
  const blackRepertoires = useMemo(() => repertoires.filter((r) => r.side === 'black'), [repertoires])

  const refreshRepertoireOverview = useCallback(async () => {
    const reps = await listRepertoires()
    setRepertoires(reps)

    const counts: RepertoireCounts = {}
    await Promise.all(
      reps.map(async (rep) => {
        const moves = await listAllMoves(rep.id)
        counts[rep.id] = moves.length
      }),
    )
    setRepertoireCounts(counts)
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
      setFlipBoard((rep?.side ?? 'white') === 'black')
      setShowDests(true)
      setShowBoardAnnotations(false)
    })()
  }, [activeRepertoireId])

  useEffect(() => {
    // Hide annotations by default in Train; keep whatever user had in Build.
    if (mode === 'train') setShowBoardAnnotations(false)
  }, [mode])

  useEffect(() => {
    // Depth base = path length at the start of the *current question position* (user to move).
    if (mode !== 'train') {
      lastTrainQuestionKeyRef.current = 'none'
      setTrainDepthBase(0)
      return
    }
    if (!trainRunActive) return
    if (!isUsersTurn) return

    const key = currentNodeId ?? null
    if (lastTrainQuestionKeyRef.current !== key) {
      lastTrainQuestionKeyRef.current = key
      setTrainDepthBase(path.length)
    }
  }, [currentNodeId, isUsersTurn, mode, path.length, trainRunActive])

  useEffect(() => {
    setHintStep(0)
  }, [children.length, currentFen, mode])

  useEffect(() => {
    // Don't keep half-finished arrows when position changes.
    setPendingArrowFrom(null)
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
      if (annotationTool === 'arrow') setPendingArrowFrom(sq)
    },
    [annotationTool, mode, showBoardAnnotations],
  )

  const onAnnotateEnd = useCallback(
    (sq: Key) => {
      if (mode !== 'build') return
      if (annotationTool === 'none') return

      if (!showBoardAnnotations) setShowBoardAnnotations(true)

      const brush = annotationBrush as DrawShape['brush']
      if (annotationTool === 'circle') {
        toggleShape({ orig: sq, brush } as DrawShape)
        return
      }

      const from = pendingArrowFrom
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
    setTrainRunKind('full')
    setTrainScopeRootId(null)
    passedPositionsRef.current = new Set()
    failedPositionsRef.current = new Set()
    setTrainPassed(0)
    setTrainFailed(0)
    setTrainRunIndex(0)
    setTrainCombo(0)
    setTrainDepthBase(0)
    lastTrainQuestionKeyRef.current = 'none'
  }, [])

  const replayToPositionId = useCallback(
    async (posId: string | null) => {
      if (!activeRepertoireId) return
      if (posId == null) {
        await goToRoot()
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
        await sleep(180)

        for (let i = 0; i < nextPath.length; i += 1) {
          const partial = nextPath.slice(0, i + 1)
          const current = partial[partial.length - 1]!
          setPath(partial)
          setCurrentNodeId(current.id)
          await sleep(240)
        }

        await refreshChildren(activeRepertoireId, posId)
      } finally {
        setReplayingSequence(false)
      }
    },
    [activeRepertoireId, goToRoot, movesById, refreshChildren],
  )

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
          setToast({ type: 'info', message: 'Ligne terminée. Nouvelle variante…' })
          return
        }
      }

      // Fully explored: reset and restart from root (fresh tour).
      exploredByParentRef.current.clear()
      setToast({ type: 'info', message: 'Répertoire exploré. On recommence un nouveau tour.' })
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

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (mode !== 'build') return
      if (!activeRepertoireId) return
      if (busy) return

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
    if (!activeRepertoireId || !activeRepertoire) return
    if (busy) return

    setBusy(true)
    setToast(null)
    setRevealed(null)
    setHintStep(0)
    try {
      const c = new Chess()
      c.load(currentFen)

      const move = c.move({ from, to, promotion: promotion ?? 'q' })
      if (!move) return

      const notation = move.san
      const nextFen = c.fen()

      const parentId = currentNodeId
      const existingChildren = await listChildrenMoves({
        repertoireId: activeRepertoireId,
        parentId,
      })

      const turnBefore = chess.turn()
      const isOurTurn = turnBefore === sideToTurn(activeRepertoire.side)

      const existingSame = existingChildren.find((m) => m.notation === notation)
      if (existingSame) {
        await selectVariant(existingSame)
        return
      }

      if (isOurTurn && existingChildren.length >= 1) {
        setToast({
          type: 'info',
          message: 'Une seule réponse est autorisée pour ta couleur à cette position.',
        })
        return
      }

      const id = await addMove({
        repertoireId: activeRepertoireId,
        parentId,
        fen: nextFen,
        notation,
        comment: '',
        eval: undefined,
      })

      const newMove: Move = {
        id,
        repertoireId: activeRepertoireId,
        parentId,
        fen: nextFen,
        notation,
        comment: '',
      }

      await selectVariant(newMove)
      await refreshChildren(activeRepertoireId, id)
      await refreshAllMoves(activeRepertoireId)
      await refreshRepertoireOverview()
    } catch {
      setToast({ type: 'error', message: 'Erreur lors de la sauvegarde du coup.' })
      // Do not crash the UI; surface via toast.
    } finally {
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
    if (!activeRepertoireId || !activeRepertoire) return
    if (busy) return
    if (!isUsersTurn) return

    setBusy(true)
    setToast(null)
    setRevealed(null)
    try {
      const c = new Chess()
      c.load(currentFen)

      const move = c.move({ from, to, promotion: 'q' })
      if (!move) return

      const notation = move.san
      const parentId = currentNodeId
      const expected = await listChildrenMoves({ repertoireId: activeRepertoireId, parentId })

      const match = expected.find((m) => m.notation === notation)
      if (!match) {
        setToast({ type: 'info', message: 'Incorrect.' })
        setTrainMissPulse(true)
        window.setTimeout(() => setTrainMissPulse(false), 450)
        setTrainCombo(0)
        if (trainRunActive) {
          const posKey = parentId ?? null
          if (!failedPositionsRef.current.has(posKey)) {
            failedPositionsRef.current.add(posKey)
            setTrainFailed((n) => n + 1)
          }
        }

        if (trainRunActive && trainRunKind === 'random' && trainRunPositions) {
          const nextIdx = trainRunIndex + 1
          setTrainRunIndex(nextIdx)
          const nextPos = trainRunPositions[nextIdx]
          if (nextPos !== undefined) {
            await replayToPositionId(nextPos)
          }
        }
        return
      }

      await selectVariant(match)
      markExplored(parentId ?? null, match.id)
      setTrainCombo((c) => c + 1)
      if (trainRunActive) {
        const posKey = parentId ?? null
        if (!passedPositionsRef.current.has(posKey)) {
          passedPositionsRef.current.add(posKey)
          setTrainPassed((n) => n + 1)
        }
      }

      if (trainRunActive && (trainRunKind === 'failed' || trainRunKind === 'random') && trainRunPositions) {
        const nextIdx = trainRunIndex + 1
        setTrainRunIndex(nextIdx)
        const nextPos = trainRunPositions[nextIdx]
        if (nextPos !== undefined) {
          await replayToPositionId(nextPos)
        }
      }
    } catch {
      setToast({ type: 'error', message: 'Erreur en mode Train.' })
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // Auto-play opponent moves in Train mode.
    if (mode !== 'train') return
    if (!activeRepertoireId || !activeRepertoire) return
    if (busy) return
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
    }, 250)

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
    trainRunKind,
  ])

  useEffect(() => {
    // When a line is completed in Train, continue with another line.
    if (mode !== 'train') return
    if (!activeRepertoireId || !activeRepertoire) return
    if (busy) return
    if (trainRunKind === 'failed') return

    // Leaf reached: no more moves from this node.
    if (children.length !== 0) return
    // If repertoire is empty, don't loop.
    if (currentNodeId == null && path.length === 0) return

    const t = window.setTimeout(() => {
      void backtrackToNextUnexplored()
    }, 1000)
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
    trainRunKind,
  ])

  useEffect(() => {
    if (!trainRunActive) return
    if (trainTotal === 0) return
    if (trainPassed !== trainTotal) return

    const passed = trainPassed
    const failed = trainFailed
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
  }, [trainFailed, trainPassed, trainRunActive, trainTotal])

  const handleCreate = async (title: string, side: Side) => {
    setBusy(true)
    setToast(null)
    try {
      const id = await createRepertoire({ title, side })
      await refreshRepertoireOverview()
      setActiveRepertoireId(id)
      setMode('build')
    } catch {
      setToast({ type: 'error', message: 'Impossible de créer le répertoire.' })
      // Do not crash the UI; surface via toast.
    } finally {
      setBusy(false)
    }
  }

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
    setBusy(true)
    setToast(null)
    try {
      await updateMove(selectedMove.id, {
        nag: moveNagDraft,
        comment: moveCommentDraft,
      })
      await refreshAllMoves(activeRepertoireId)
      await refreshRepertoireOverview()
    } catch {
      setToast({ type: 'error', message: "Impossible d'enregistrer le commentaire." })
    } finally {
      setBusy(false)
    }
  }, [
    activeRepertoireId,
    moveCommentDraft,
    moveNagDraft,
    refreshAllMoves,
    refreshRepertoireOverview,
    selectedMove?.id,
  ])

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-8">
      {view === 'session' ? (
        <button
          type="button"
          className="fixed right-4 top-4 z-40 counter"
          aria-label="Paramètres de l'échiquier"
          onClick={() => setSettingsOpen(true)}
          title="Paramètres"
        >
          ⚙
        </button>
      ) : null}
      {view === 'home' ? (
        <div className="mx-auto w-full max-w-[920px] text-left">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1>Répertoires</h1>
            <button
              type="button"
              className="counter text-sm"
              onClick={() => void getSupabaseClient().auth.signOut()}
            >
              Déconnexion
            </button>
          </div>
          <p>Sélectionne un répertoire pour ouvrir Build/Train.</p>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]">
              <div className="space-y-5">
                <HomeSection
                  title="Blancs"
                  repertoires={whiteRepertoires}
                  repertoireCounts={repertoireCounts}
                  onOpen={(id) => {
                    setActiveRepertoireId(id)
                    setMode('build')
                    setView('session')
                  }}
                />
                <HomeSection
                  title="Noirs"
                  repertoires={blackRepertoires}
                  repertoireCounts={repertoireCounts}
                  onOpen={(id) => {
                    setActiveRepertoireId(id)
                    setMode('build')
                    setView('session')
                  }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]">
              <CreateRepertoireForm
                onCreate={async (title, side) => {
                  await handleCreate(title, side)
                  setMode('build')
                  setView('session')
                }}
                disabled={busy}
              />
            </div>
          </div>
        </div>
      ) : (
        mode === 'train' ? (
          <div className="mx-auto w-full max-w-[720px]">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0 text-left">
                <div className="truncate text-sm font-medium text-[var(--text-h)]">
                  {activeRepertoire?.title ?? '—'}
                </div>
                <div className="text-xs opacity-80">{activeRepertoire?.side ?? '—'}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" className="counter" onClick={() => setView('home')}>
                  Home
                </button>
                <button type="button" className="counter" onClick={() => setMode('build')}>
                  Build
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]">
              <div className="mx-auto w-full max-w-[420px]">
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
                    drawableEnabled={showBoardAnnotations}
                    drawableVisible={showBoardAnnotations}
                    shapes={currentShapes}
                    onShapesChange={(next) => {
                      setShapesByFen((prev) => ({ ...prev, [currentFen]: next }))
                    }}
                    annotationMode={false}
                  />
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-left">
                  <div className="text-sm">
                    <div className="font-medium text-[var(--text-h)]">Run</div>
                    {!replayingSequence ? (
                      <div className="font-mono">
                        {children.length === 0
                          ? 'Fin de ligne'
                          : isUsersTurn
                            ? 'À toi'
                            : 'Réponse…'}
                      </div>
                    ) : null}
                    {trainRunActive ? (
                      <>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--code-bg)]">
                          <div
                            className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                            style={{ width: `${trainTotal === 0 ? 0 : (trainPassed / trainTotal) * 100}%` }}
                          />
                        </div>
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs opacity-80">
                          <div>
                            Restantes: {trainRemaining} · Passées: {trainPassed} · Failed: {trainFailed}
                          </div>
                          <div className="font-mono">Profondeur = {Math.max(0, path.length - trainDepthBase)}</div>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {trainCombo >= 3 ? (
                    <div
                      className="flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs font-medium text-[var(--text-h)]"
                      title="Combo"
                    >
                      <span className="select-none">🔥</span>
                      <span className="font-mono">{trainCombo}</span>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    className="counter"
                    disabled={!isUsersTurn || !hintMoveKeys}
                    onClick={() => {
                      if (!isUsersTurn) return
                      if (!hintMoveKeys) return
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
                    className="counter"
                    disabled={busy}
                    onClick={() => {
                      void replayToPositionId(currentNodeId)
                    }}
                  >
                    Replay moves
                  </button>
                </div>

                {trainMissPulse ? (
                  <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/10 px-3 py-2 text-left text-sm font-medium text-red-600 dark:text-red-300">
                    Coup incorrect.
                  </div>
                ) : null}

                <div className="mt-3 text-left">
                  <div className="text-sm font-medium text-[var(--text-h)]">Chemin</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {path.length === 0 ? (
                      <span className="rounded-md bg-[var(--code-bg)] px-2 py-1 font-mono text-sm text-[var(--text-h)]">
                        (root)
                      </span>
                    ) : (
                      path.map((move) => (
                        <span
                          key={move.id}
                          className="rounded-md bg-[var(--code-bg)] px-2 py-1 font-mono text-sm text-[var(--text-h)]"
                        >
                          {move.notation}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {hintStep > 0 ? (
                  <div className="mt-3 text-left text-sm opacity-80">
                    {hintStep === 1 ? 'Hint: pièce à jouer' : 'Hint: case de destination'}
                  </div>
                ) : null}

                {toast ? (
                  <div
                    className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                    role="status"
                  >
                    <span className="font-medium">{toast.type === 'error' ? 'Erreur' : 'Info'}</span>
                    <span className="ml-2">{toast.message}</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-[1126px] grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
            <aside className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-[var(--text-h)]">Répertoire</div>
                  <div className="text-sm">{activeRepertoire?.title ?? '—'}</div>
                  <div className="mt-1 text-xs opacity-80">{activeRepertoire?.side ?? '—'}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="counter"
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
                  <button type="button" className="counter" onClick={() => setView('home')}>
                    Home
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-[var(--text-h)]" htmlFor="repSelect">
                  Répertoire
                </label>
                <select
                  id="repSelect"
                  className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                  value={activeRepertoireId ?? ''}
                  onChange={(e) => {
                    const v = e.target.value
                    setActiveRepertoireId(v === '' ? null : v)
                  }}
                >
                  <option value="" disabled>
                    —
                  </option>
                  {repertoires.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.title} ({r.side})
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-4">
                <MoveTreeView
                  forest={forest}
                  pathIds={pathToIdSet(path)}
                  onSelectMove={selectVariant}
                  onDeleteMove={onDeleteMove}
                />
              </div>

              {mode === 'build' && selectedMove ? (
                <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-left text-sm">
                  <div className="text-xs font-medium text-[var(--text-h)]">Coup</div>
                  <div className="mt-1 font-mono text-[var(--text-h)]">
                    {selectedMove.notation}
                    {formatNagForInline(selectedMove.nag)}
                  </div>

                  <label className="mt-3 block text-xs font-medium text-[var(--text-h)]" htmlFor="nagSelect">
                    Annotation PGN
                  </label>
                  <select
                    id="nagSelect"
                    className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    value={moveNagDraft}
                    onChange={(e) => setMoveNagDraft(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">(aucune)</option>
                    <option value="!">!</option>
                    <option value="?">?</option>
                    <option value="!!">!!</option>
                    <option value="??">??</option>
                    <option value="!?">!?</option>
                    <option value="?!">?!</option>
                    <option value="=">=</option>
                    <option value="+/=">+/=</option>
                    <option value="=/+">=/+</option>
                    <option value="+-">+-</option>
                    <option value="-+">-+</option>
                    <option value="∞">∞</option>
                  </select>

                  <label
                    className="mt-3 block text-xs font-medium text-[var(--text-h)]"
                    htmlFor="commentInput"
                  >
                    Commentaire
                  </label>
                  <textarea
                    id="commentInput"
                    className="mt-2 w-full resize-none rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                    rows={3}
                    value={moveCommentDraft}
                    onChange={(e) => setMoveCommentDraft(e.target.value)}
                    disabled={busy}
                  />

                  <div className="mt-3 flex justify-end">
                    <button type="button" className="counter" disabled={busy} onClick={() => void saveMoveMeta()}>
                      Save
                    </button>
                  </div>
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

            <main className="rounded-xl border border-[var(--border)] bg-[var(--social-bg)] p-4 shadow-[var(--shadow)]">
              <div className="mx-auto w-full max-w-[420px]">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      {(
                        [
                          { id: 'green', cls: 'bg-green-500' },
                          { id: 'red', cls: 'bg-red-500' },
                          { id: 'blue', cls: 'bg-blue-500' },
                        ] as const
                      ).map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className={[
                            'h-5 w-5 rounded-full border border-[var(--border)]',
                            c.cls,
                            annotationBrush === c.id ? 'ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--social-bg)]' : '',
                          ].join(' ')}
                          onClick={() => setAnnotationBrush(c.id)}
                          aria-label={`Couleur ${c.id}`}
                          title={`Couleur ${c.id}`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      className={[
                        'counter !px-2 !py-1',
                        annotationTool === 'arrow' ? 'bg-[var(--accent)] text-white ring-2 ring-[var(--accent)]' : '',
                      ].join(' ')}
                      onClick={() => setAnnotationTool((t) => (t === 'arrow' ? 'none' : 'arrow'))}
                      aria-pressed={annotationTool === 'arrow'}
                      title="Flèches (drag)"
                    >
                      ↗
                    </button>
                    <button
                      type="button"
                      className={[
                        'counter !px-2 !py-1',
                        annotationTool === 'circle' ? 'bg-[var(--accent)] text-white ring-2 ring-[var(--accent)]' : '',
                      ].join(' ')}
                      onClick={() => setAnnotationTool((t) => (t === 'circle' ? 'none' : 'circle'))}
                      aria-pressed={annotationTool === 'circle'}
                      title="Cercles (1 clic)"
                    >
                      ◯
                    </button>
                  </div>
                </div>
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
                  onShapesChange={(next) => {
                    setShapesByFen((prev) => ({ ...prev, [currentFen]: next }))
                  }}
                  annotationMode={isAnnotating}
                  onAnnotateStart={onAnnotateStart}
                  onAnnotateEnd={onAnnotateEnd}
                />

                {mode === 'build' ? (
                  <OpeningExplorer
                    fen={currentFen}
                    collapsed={openingExplorerCollapsed}
                    onToggleCollapsed={() => setOpeningExplorerCollapsed((v) => !v)}
                    onPlayMove={(uci) => void onPlayExplorerMove(uci)}
                  />
                ) : null}
              </div>
            </main>
          </div>
        )
      )}

      {modal?.kind === 'trainStart' ? (
        <ModalFrame
          title="Démarrer un entraînement"
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button
                type="button"
                className="counter"
                disabled={modal.fullCount === 0}
                onClick={() => {
                  setModal(null)
                  void startTrainRun({ kind: 'full' })
                }}
              >
                Tout le répertoire
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
                Variante sélectionnée
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
                Positions aléatoires
              </button>
            </div>
          }
        >
          <div className="space-y-2 text-sm">
            <div>
              Répertoire complet: <span className="font-mono">{modal.fullCount}</span> positions.
            </div>
            <div>
              Variante sélectionnée: <span className="font-mono">{modal.selectionCount}</span> positions.
            </div>
          </div>
          {!modal.hasSelection ? (
            <div className="mt-2 text-sm opacity-80">
              Sélectionne un coup dans l'arbre pour entraîner uniquement cette variante.
            </div>
          ) : null}
          {modal.fullCount === 0 ? (
            <div className="mt-2 text-sm opacity-80">Aucune position entraînable trouvée.</div>
          ) : null}
        </ModalFrame>
      ) : null}

      {modal?.kind === 'trainRandomConfig' ? (
        <ModalFrame
          title="Positions aléatoires"
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setModal(null)}>
                Annuler
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
                Démarrer
              </button>
            </div>
          }
        >
          <div className="space-y-3 text-sm">
            <div>
              Nombre de positions (max{' '}
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
              <span className="text-[var(--text-h)]">Se concentrer sur la variante sélectionnée</span>
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
                title={!modal.hasSelection ? 'Sélectionne un coup dans l’arbre pour activer.' : ''}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
            {!modal.hasSelection ? (
              <div className="text-xs opacity-80">Sélectionne un coup dans l’arbre pour activer ce mode.</div>
            ) : null}
          </div>
        </ModalFrame>
      ) : null}

      {modal?.kind === 'trainSummary' ? (
        <ModalFrame
          title="Résumé du run"
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
                Rejouer les échouées
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

      {modal?.kind === 'confirmDeleteMove' ? (
        <ModalFrame
          title="Confirmer la suppression"
          onClose={() => setModal(null)}
          actions={
            <div className="flex gap-2">
              <button type="button" className="counter" onClick={() => setModal(null)}>
                Annuler
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
                      setToast({ type: 'error', message: 'Impossible de supprimer cette variante.' })
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                Supprimer
              </button>
            </div>
          }
        >
          <div className="text-sm">
            Supprimer <span className="font-mono">{modal.move.notation}</span> et toute sa sous-variante ?
          </div>
        </ModalFrame>
      ) : null}

      {settingsOpen ? (
        <SettingsPopup
          fen={currentFen}
          flipBoard={flipBoard}
          showDests={showDests}
          showBoardAnnotations={showBoardAnnotations}
          onClose={() => setSettingsOpen(false)}
          onCopyFen={() => void navigator.clipboard.writeText(currentFen)}
          onToggleFlip={() => setFlipBoard((v) => !v)}
          onToggleDests={() => setShowDests((v) => !v)}
          onToggleAnnotations={() => setShowBoardAnnotations((v) => !v)}
        />
      ) : null}
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
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
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
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>
        <div className="mt-3">{children}</div>
        <div className="mt-4 flex justify-end">{actions}</div>
      </div>
    </div>
  )
}

function SummaryBlock({ total, passed, failed }: { total: number; passed: number; failed: number }) {
  const played = total
  const success = Math.max(0, total - failed)
  const pct = total === 0 ? 0 : Math.round((success / total) * 100)
  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">Positions jouées</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{played}</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">Réussite</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{pct}%</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">Passées</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{passed}</div>
      </div>
      <div className="rounded-md border border-[var(--border)] p-3">
        <div className="opacity-80">Fails</div>
        <div className="mt-1 font-mono text-[var(--text-h)]">{failed}</div>
      </div>
    </div>
  )
}

function SettingsPopup({
  fen,
  flipBoard,
  showDests,
  showBoardAnnotations,
  onClose,
  onCopyFen,
  onToggleFlip,
  onToggleDests,
  onToggleAnnotations,
}: {
  fen: string
  flipBoard: boolean
  showDests: boolean
  showBoardAnnotations: boolean
  onClose: () => void
  onCopyFen: () => void
  onToggleFlip: () => void
  onToggleDests: () => void
  onToggleAnnotations: () => void
}) {
  return (
    <ModalFrame
      title="Paramètres"
      onClose={onClose}
      actions={<button type="button" className="counter" onClick={onClose}>OK</button>}
    >
      <div className="space-y-4 text-left text-sm">
        <ToggleRow label="Inverser l'échiquier" checked={flipBoard} onChange={onToggleFlip} />
        <ToggleRow label="Afficher les destinations" checked={showDests} onChange={onToggleDests} />
        <ToggleRow
          label="Afficher annotations"
          checked={showBoardAnnotations}
          onChange={onToggleAnnotations}
        />
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-[var(--text-h)]">FEN</span>
            <button type="button" className="counter text-xs" onClick={onCopyFen}>
              Copy FEN
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
}: {
  label: string
  checked: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--text-h)]">{label}</span>
      <button
        type="button"
        className={`toggle-switch ${checked ? 'is-on' : ''}`}
        role="switch"
        aria-checked={checked}
        onClick={onChange}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  )
}

function HomeSection({
  title,
  repertoires,
  repertoireCounts,
  onOpen,
}: {
  title: string
  repertoires: Repertoire[]
  repertoireCounts: RepertoireCounts
  onOpen: (id: string) => void
}) {
  return (
    <section>
      <div className="text-sm font-medium text-[var(--text-h)]">{title}</div>
      <div className="mt-3 space-y-2">
        {repertoires.length === 0 ? (
          <div className="text-sm opacity-80">Aucun répertoire.</div>
        ) : (
          repertoires.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-left hover:shadow-[var(--shadow)]"
              onClick={() => {
                onOpen(r.id)
              }}
            >
              <div className="text-sm font-medium text-[var(--text-h)]">{r.title}</div>
              <div className="mt-0.5 text-xs opacity-80">
                {repertoireCounts[r.id] ?? 0} positions enregistrées
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

function CreateRepertoireForm({
  onCreate,
  disabled,
}: {
  onCreate: (title: string, side: Side) => Promise<void>
  disabled?: boolean
}) {
  const [title, setTitle] = useState('')
  const [side, setSide] = useState<Side>('white')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    await onCreate(t, side)
    setTitle('')
  }

  return (
    <form className="mt-6 border-t border-[var(--border)] pt-4 text-[var(--text-h)]" onSubmit={submit}>
      <div className="text-sm font-medium text-[var(--text-h)]">Nouveau répertoire</div>

      <label className="mt-3 block text-sm font-medium text-[var(--text-h)]" htmlFor="newTitle">
        Nom
      </label>
      <input
        id="newTitle"
        className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="E4 White Repertoire"
        maxLength={80}
        disabled={disabled}
      />

      <label className="mt-3 block text-sm font-medium text-[var(--text-h)]" htmlFor="newSide">
        Je joue
      </label>
      <select
        id="newSide"
        className="mt-2 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
        value={side}
        onChange={(e) => setSide(e.target.value as Side)}
        disabled={disabled}
      >
        <option value="white">Blancs</option>
        <option value="black">Noirs</option>
      </select>

      <button type="submit" className="counter mt-4 w-full" disabled={disabled || !title.trim()}>
        Créer
      </button>
    </form>
  )
}


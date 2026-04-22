import { useEffect, useLayoutEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'

import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

type AnnotateVariant = 'arrow' | 'circle'

type Props = {
  fen: string
  dests: Map<Key, Key[]>
  turnColor: 'white' | 'black'
  orientation?: 'white' | 'black'
  showCoordinates?: boolean
  lastMove?: [Key, Key] | null
  selectedSquare?: Key | null
  showDests?: boolean
  drawableEnabled?: boolean
  drawableVisible?: boolean
  shapes?: DrawShape[]
  /** Shapes affichées mais non persistées (ex. prévisualisation de flèche au drag) */
  annotationAutoShapes?: DrawShape[]
  onShapesChange?: (shapes: DrawShape[]) => void
  onMove?: (from: Key, to: Key) => void | Promise<void>
  annotationMode?: boolean
  annotateVariant?: AnnotateVariant | null
  onAnnotateStart?: (square: Key) => void
  onAnnotateMove?: (square: Key | null) => void
  onAnnotateEnd?: (square: Key | null) => void
  /** Mobile : désactive le drag des pièces (sélection + case de destination, plus fluide au doigt). */
  touchMoveMode?: boolean
}

export function Board({
  fen,
  dests,
  turnColor,
  orientation = 'white',
  showCoordinates = true,
  lastMove,
  selectedSquare,
  showDests = true,
  drawableEnabled = false,
  drawableVisible = false,
  shapes = [],
  annotationAutoShapes = [],
  onShapesChange,
  onMove,
  annotationMode = false,
  annotateVariant = null,
  onAnnotateStart,
  onAnnotateMove,
  onAnnotateEnd,
  touchMoveMode = false,
}: Props) {
  const cgRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<Api | null>(null)
  const annotDragStartRef = useRef<Key | null>(null)
  const annotPointerIdRef = useRef<number | null>(null)
  const annotateVariantRef = useRef<AnnotateVariant | null>(annotateVariant)
  const onAnnotateMoveRef = useRef(onAnnotateMove)

  const fenRef = useRef(fen)
  const destsRef = useRef(dests)
  const turnColorRef = useRef(turnColor)
  const onMoveRef = useRef(onMove)
  const onShapesChangeRef = useRef(onShapesChange)
  useLayoutEffect(() => {
    fenRef.current = fen
    destsRef.current = dests
    turnColorRef.current = turnColor
    onMoveRef.current = onMove
    onShapesChangeRef.current = onShapesChange
  }, [fen, dests, turnColor, onMove, onShapesChange])

  useLayoutEffect(() => {
    annotateVariantRef.current = annotateVariant
  }, [annotateVariant])

  useLayoutEffect(() => {
    onAnnotateMoveRef.current = onAnnotateMove
  }, [onAnnotateMove])

  const eventToSquare = (e: { clientX: number; clientY: number }, el: HTMLDivElement): Key | null => {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null

    const col = Math.max(0, Math.min(7, Math.floor((x / rect.width) * 8)))
    const row = Math.max(0, Math.min(7, Math.floor((y / rect.height) * 8)))

    const files = 'abcdefgh'
    if (orientation === 'white') {
      const file = files[col]!
      const rank = 8 - row
      return `${file}${rank}` as Key
    } else {
      const file = files[7 - col]!
      const rank = row + 1
      return `${file}${rank}` as Key
    }
  }

  useEffect(() => {
    const el = cgRef.current
    if (!el) return
    if (!drawableEnabled || !drawableVisible) return

    const onContextMenu = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    el.addEventListener('contextmenu', onContextMenu, { capture: true })
    el.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () => {
      el.removeEventListener('contextmenu', onContextMenu, { capture: true } as AddEventListenerOptions)
      el.removeEventListener('pointerdown', onPointerDown, { capture: true } as AddEventListenerOptions)
    }
  }, [drawableEnabled, drawableVisible])

  useEffect(() => {
    const el = cgRef.current
    if (!el) return

    const drawableCfg: {
      enabled?: boolean
      visible?: boolean
      defaultSnapToValidMove?: boolean
      eraseOnClick?: boolean
      shapes?: DrawShape[]
      autoShapes?: DrawShape[]
      onChange?: (s: DrawShape[]) => void
    } = {
      enabled: drawableEnabled,
      visible: drawableVisible,
      defaultSnapToValidMove: false,
      eraseOnClick: true,
      shapes,
      autoShapes: [],
      onChange: (s) => onShapesChangeRef.current?.(s),
    }

    const api = Chessground(el, {
      orientation,
      coordinates: showCoordinates,
      blockTouchScroll: touchMoveMode,
      turnColor: turnColorRef.current,
      movable: {
        free: false,
        color: turnColorRef.current,
        dests: destsRef.current,
        showDests,
        events: {
          after: async (from, to) => {
            const fromKey = from as Key
            const toKey = to as Key
            try {
              await onMoveRef.current?.(fromKey, toKey)
            } catch {
              api.set({ fen: fenRef.current })
            }
          },
        },
      },
      draggable: {
        enabled: !touchMoveMode,
        showGhost: !touchMoveMode,
        distance: 3,
        autoDistance: true,
        deleteOnDropOff: false,
      },
      lastMove: lastMove ?? undefined,
      selected: selectedSquare ?? undefined,
      drawable: drawableCfg,
      fen: fenRef.current,
    })

    apiRef.current = api
    return () => {
      apiRef.current = null
      el.innerHTML = ''
    }
    // Intentionally omit lastMove / selectedSquare / shapes: they are applied in the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid destroying the instance on every draw/highlight
  }, [orientation, showCoordinates, drawableEnabled, drawableVisible, showDests, touchMoveMode])

  useEffect(() => {
    apiRef.current?.set({
      fen,
      lastMove: lastMove ?? undefined,
      selected: selectedSquare ?? undefined,
      turnColor,
      movable: { color: turnColor, dests, showDests },
      draggable: {
        enabled: !touchMoveMode,
        showGhost: !touchMoveMode,
        distance: 3,
        autoDistance: true,
        deleteOnDropOff: false,
      },
      blockTouchScroll: touchMoveMode,
      drawable: { enabled: drawableEnabled, visible: drawableVisible, shapes, autoShapes: annotationAutoShapes },
    })
  }, [
    annotationAutoShapes,
    dests,
    drawableEnabled,
    drawableVisible,
    fen,
    lastMove,
    selectedSquare,
    shapes,
    showDests,
    touchMoveMode,
    turnColor,
  ])

  return (
    <div className="aspect-square w-full">
      <div
        ref={cgRef}
        className="h-full w-full"
        onContextMenu={(e) => {
          if (!drawableEnabled || !drawableVisible) return
          e.preventDefault()
          e.stopPropagation()
        }}
        onPointerDown={(e) => {
          if (annotationMode && e.button === 0) {
            const el = cgRef.current
            if (!el) return
            const sq = eventToSquare(e, el)
            if (!sq) return
            e.preventDefault()
            e.stopPropagation()
            annotDragStartRef.current = sq
            annotPointerIdRef.current = e.pointerId
            onAnnotateStart?.(sq)
            if (annotateVariantRef.current === 'arrow') {
              try {
                el.setPointerCapture(e.pointerId)
              } catch {
                /* ignore */
              }
            }
            return
          }
          if (!drawableEnabled || !drawableVisible) return
          if (e.button === 2) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onPointerMove={(e) => {
          if (!annotationMode) return
          if (annotPointerIdRef.current !== e.pointerId) return
          if (annotateVariantRef.current !== 'arrow') return
          const el = cgRef.current
          if (!el) return
          const sq = eventToSquare(e, el)
          onAnnotateMoveRef.current?.(sq)
        }}
        onPointerUp={(e) => {
          if (!annotationMode) return
          if (e.button !== 0) return
          if (annotPointerIdRef.current !== e.pointerId) return

          const el = cgRef.current
          if (!el) return
          e.preventDefault()
          e.stopPropagation()
          onAnnotateMoveRef.current?.(null)
          const sq = eventToSquare(e, el)
          try {
            el.releasePointerCapture(e.pointerId)
          } catch {
            /* not captured */
          }
          annotDragStartRef.current = null
          annotPointerIdRef.current = null
          onAnnotateEnd?.(sq ?? null)
        }}
        onPointerCancel={(e) => {
          if (annotPointerIdRef.current !== e.pointerId) return
          onAnnotateMoveRef.current?.(null)
          const el = cgRef.current
          if (el) {
            try {
              el.releasePointerCapture(e.pointerId)
            } catch {
              /* ignore */
            }
          }
          annotDragStartRef.current = null
          annotPointerIdRef.current = null
          onAnnotateEnd?.(null)
        }}
      />
    </div>
  )
}

import { useEffect, useRef } from 'react'
import { Chessground } from 'chessground'
import type { Api } from 'chessground/api'
import type { DrawShape } from 'chessground/draw'
import type { Key } from 'chessground/types'

import 'chessground/assets/chessground.base.css'
import 'chessground/assets/chessground.brown.css'
import 'chessground/assets/chessground.cburnett.css'

type Props = {
  fen: string
  dests: Map<Key, Key[]>
  turnColor: 'white' | 'black'
  orientation?: 'white' | 'black'
  lastMove?: [Key, Key] | null
  selectedSquare?: Key | null
  showDests?: boolean
  drawableEnabled?: boolean
  drawableVisible?: boolean
  shapes?: DrawShape[]
  onShapesChange?: (shapes: DrawShape[]) => void
  onMove?: (from: Key, to: Key) => void | Promise<void>
  annotationMode?: boolean
  onAnnotateStart?: (square: Key) => void
  onAnnotateEnd?: (square: Key) => void
}

export function Board({
  fen,
  dests,
  turnColor,
  orientation = 'white',
  lastMove,
  selectedSquare,
  showDests = true,
  drawableEnabled = false,
  drawableVisible = false,
  shapes = [],
  onShapesChange,
  onMove,
  annotationMode = false,
  onAnnotateStart,
  onAnnotateEnd,
}: Props) {
  const cgRef = useRef<HTMLDivElement | null>(null)
  const apiRef = useRef<Api | null>(null)
  const annotDragStartRef = useRef<Key | null>(null)
  const annotPointerIdRef = useRef<number | null>(null)

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
      // Must be native + capture to reliably beat Chrome's context menu on Windows.
      e.preventDefault()
      e.stopPropagation()
    }

    const onPointerDown = (e: PointerEvent) => {
      // Ensure right-click drag (Chessground drawable) isn't hijacked by the browser.
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
    if (!cgRef.current) return
    const el = cgRef.current

    const drawableCfg: {
      enabled?: boolean
      visible?: boolean
      defaultSnapToValidMove?: boolean
      eraseOnClick?: boolean
      shapes?: DrawShape[]
      onChange?: (s: DrawShape[]) => void
    } = {
      enabled: drawableEnabled,
      visible: drawableVisible,
      defaultSnapToValidMove: false,
      eraseOnClick: true,
      shapes,
      onChange: (s) => onShapesChange?.(s),
    }

    const api = Chessground(el, {
      orientation,
      coordinates: true,
      turnColor,
      movable: {
        free: false,
        color: turnColor,
        dests,
        showDests,
        events: {
          after: async (from, to) => {
            const fromKey = from as Key
            const toKey = to as Key
            // Revert immediately; parent state is the source of truth.
            api.set({ fen })
            await onMove?.(fromKey, toKey)
          },
        },
      },
      lastMove: lastMove ?? undefined,
      selected: selectedSquare ?? undefined,
      drawable: drawableCfg,
      fen,
    })

    apiRef.current = api
    return () => {
      apiRef.current = null
      // chessground doesn't expose a hard destroy in all builds; clearing DOM is enough.
      el.innerHTML = ''
    }
  }, [
    dests,
    drawableEnabled,
    drawableVisible,
    fen,
    lastMove,
    onMove,
    onShapesChange,
    orientation,
    selectedSquare,
    shapes,
    showDests,
    turnColor,
  ])

  useEffect(() => {
    apiRef.current?.set({
      fen,
      lastMove: lastMove ?? undefined,
      selected: selectedSquare ?? undefined,
      turnColor,
      movable: { color: turnColor, dests, showDests },
      drawable: { enabled: drawableEnabled, visible: drawableVisible, shapes },
    })
  }, [dests, drawableEnabled, drawableVisible, fen, lastMove, selectedSquare, shapes, showDests, turnColor])

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
            return
          }
          if (!drawableEnabled || !drawableVisible) return
          if (e.button === 2) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        onPointerUp={(e) => {
          if (!annotationMode) return
          if (e.button !== 0) return
          if (annotPointerIdRef.current !== e.pointerId) return

          const el = cgRef.current
          if (!el) return
          const sq = eventToSquare(e, el)
          if (!sq) return
          e.preventDefault()
          e.stopPropagation()
          onAnnotateEnd?.(sq)
          annotDragStartRef.current = null
          annotPointerIdRef.current = null
        }}
        onPointerCancel={(e) => {
          if (annotPointerIdRef.current !== e.pointerId) return
          annotDragStartRef.current = null
          annotPointerIdRef.current = null
        }}
      />
    </div>
  )
}


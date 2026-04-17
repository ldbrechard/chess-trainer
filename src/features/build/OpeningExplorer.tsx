import { useEffect, useMemo, useRef, useState } from 'react'

type ExplorerMove = {
  uci: string
  san: string
  white: number
  draws: number
  black: number
}

type ExplorerOpening = { eco?: string; name?: string } | null

type ExplorerResponse = {
  white?: number
  draws?: number
  black?: number
  moves?: ExplorerMove[]
  opening?: ExplorerOpening
  queuePosition?: number
}

type Props = {
  fen: string
  collapsed?: boolean
  onToggleCollapsed?: () => void
  onPlayMove?: (uci: string) => void
}

const RATING_BUCKETS = [1600, 1800, 2000, 2200, 2500] as const

function clampPct(n: number) {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, n))
}

function pct(part: number, total: number) {
  if (total <= 0) return 0
  return clampPct((part / total) * 100)
}

function fmtInt(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n)
  } catch {
    return String(n)
  }
}

function isLikely429(err: unknown) {
  if (typeof err !== 'object' || err === null || !('message' in err)) return false
  const msg = (err as { message?: unknown }).message
  return typeof msg === 'string' && msg.includes('429')
}

export function OpeningExplorer({ fen, collapsed = false, onToggleCollapsed, onPlayMove }: Props) {
  const [minIdx, setMinIdx] = useState(0)
  const [maxIdx, setMaxIdx] = useState(RATING_BUCKETS.length - 1)
  const [data, setData] = useState<ExplorerResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [debugUrl, setDebugUrl] = useState<string | null>(null)

  const cacheRef = useRef<Map<string, ExplorerResponse>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const token = (import.meta.env.VITE_LICHESS_TOKEN as string | undefined | null)?.trim() ?? ''
  const [effectiveMinIdx, effectiveMaxIdx] = minIdx <= maxIdx ? [minIdx, maxIdx] : [maxIdx, minIdx]
  const ratingsParam = useMemo(() => {
    const slice = RATING_BUCKETS.slice(effectiveMinIdx, effectiveMaxIdx + 1)
    return slice.join(',')
  }, [effectiveMaxIdx, effectiveMinIdx])
  const cacheKey = useMemo(() => `${fen}::ratings=${ratingsParam}`, [fen, ratingsParam])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      setData(null)
      setError("Token Lichess manquant. Ajoute `VITE_LICHESS_TOKEN` dans `.env` (non commité).")
      return
    }

    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setData(cached)
      setError(null)
      return
    }

    // Debounce + abort to avoid spamming explorer.
    setLoading(true)
    setError(null)
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const url = new URL('https://explorer.lichess.ovh/lichess')
          url.searchParams.set('fen', fen)
          url.searchParams.set('variant', 'chess')
          url.searchParams.set('moves', '12')
          if (ratingsParam) url.searchParams.set('ratings', ratingsParam)
          setDebugUrl(url.toString())

          const res = await fetch(url.toString(), {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${token}`,
            },
            signal: ac.signal,
          })

          if (!res.ok) {
            let bodyHint = ''
            try {
              const text = await res.text()
              const oneLine = text.replace(/\s+/g, ' ').trim()
              bodyHint = oneLine ? ` — ${oneLine.slice(0, 140)}` : ''
            } catch {
              // ignore
            }
            throw new Error(`Explorer HTTP ${res.status}${bodyHint}`)
          }

          const json = (await res.json()) as ExplorerResponse
          cacheRef.current.set(cacheKey, json)
          setData(json)
          setError(null)
        } catch (e) {
          if (e instanceof DOMException && e.name === 'AbortError') return
          if (e instanceof Error && e.name === 'AbortError') return
          setData(null)
          const msg = e instanceof Error ? e.message : String(e)
          if (isLikely429(e)) {
            setError('Lichess Explorer est temporairement rate-limité (HTTP 429).')
          } else if (msg.includes('HTTP ')) {
            setError(msg)
          } else {
            setError('Impossible de contacter Lichess Explorer (réseau/CORS).')
          }
        } finally {
          setLoading(false)
        }
      })()
    }, 220)

    return () => {
      window.clearTimeout(t)
      ac.abort()
    }
  }, [cacheKey, fen, ratingsParam, token])

  const moves = data?.moves ?? []

  return (
    <div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--bg)] p-3 text-left text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button
            type="button"
            className="text-xs font-medium text-[var(--text-h)] hover:underline"
            onClick={onToggleCollapsed}
            aria-expanded={!collapsed}
            title={collapsed ? 'Déplier' : 'Replier'}
          >
            {collapsed ? '▸' : '▾'} Arbre d’ouverture (Lichess)
          </button>
          <div className="mt-1 truncate text-xs opacity-80">
            {data?.opening?.name ? (
              <>
                {data.opening.eco ? <span className="font-mono">{data.opening.eco}</span> : null}
                {data.opening.eco ? <span className="mx-1 opacity-60">·</span> : null}
                <span>{data.opening.name}</span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>
        <div className="text-xs opacity-80">{loading ? '…' : null}</div>
      </div>

      {collapsed ? null : (
        <>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-[var(--text-h)]">ELO</div>
              <div className="font-mono text-[10px] opacity-80">
                {RATING_BUCKETS[effectiveMinIdx]}+ → {RATING_BUCKETS[effectiveMaxIdx]}+
              </div>
            </div>

            <div className="mt-2">
              <div className="relative h-8">
                {/* Two thumbs, one visual slider */}
                <input
                  type="range"
                  min={0}
                  max={RATING_BUCKETS.length - 1}
                  step={1}
                  value={effectiveMinIdx}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setMinIdx(v)
                    if (v > maxIdx) setMaxIdx(v)
                  }}
                  className="absolute inset-0 w-full appearance-none bg-transparent"
                  aria-label="ELO min"
                />
                <input
                  type="range"
                  min={0}
                  max={RATING_BUCKETS.length - 1}
                  step={1}
                  value={effectiveMaxIdx}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setMaxIdx(v)
                    if (v < minIdx) setMinIdx(v)
                  }}
                  className="absolute inset-0 w-full appearance-none bg-transparent"
                  aria-label="ELO max"
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[10px] opacity-70">
                <span>{RATING_BUCKETS[0]}+</span>
                <span>{RATING_BUCKETS[RATING_BUCKETS.length - 1]}+</span>
              </div>
            </div>
          </div>

          {error ? (
            <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/10 px-2 py-1 text-xs text-red-700 dark:text-red-200">
              <div className="whitespace-pre-wrap">{error}</div>
              {debugUrl ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <a
                    className="rounded-md border border-red-400/40 bg-white/40 px-2 py-1 font-mono text-[10px] text-red-800 hover:underline dark:bg-black/20 dark:text-red-100"
                    href={debugUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ouvrir la requête
                  </a>
                  <button
                    type="button"
                    className="rounded-md border border-red-400/40 bg-white/40 px-2 py-1 font-mono text-[10px] text-red-800 dark:bg-black/20 dark:text-red-100"
                    onClick={() => {
                      void navigator.clipboard.writeText(debugUrl)
                    }}
                  >
                    Copier l’URL
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            {moves.length === 0 && !loading && !error ? <div className="text-xs opacity-80">(pas de données)</div> : null}
            {moves.map((m) => {
              const total = (m.white ?? 0) + (m.draws ?? 0) + (m.black ?? 0)
              const w = pct(m.white ?? 0, total)
              const d = pct(m.draws ?? 0, total)
              const b = Math.max(0, 100 - w - d) // keep visual sum at 100

              const wLabel = Math.round(w)
              const dLabel = Math.round(d)
              const bLabel = Math.round(b)

              return (
                <button
                  key={m.uci}
                  type="button"
                  className="w-full rounded-md border border-[var(--border)] px-2 py-1 text-left hover:bg-[var(--accent-bg)]"
                  onClick={() => onPlayMove?.(m.uci)}
                  title="Jouer ce coup"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[var(--text-h)]">{m.san}</div>
                    <div className="font-mono text-xs opacity-80">{fmtInt(total)}</div>
                  </div>
                  <div className="mt-1 overflow-hidden rounded border border-[var(--border)] bg-[var(--code-bg)]">
                    <div className="flex h-4 w-full">
                      <div style={{ width: `${w}%` }} className="relative bg-white">
                        {w >= 12 ? (
                          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-black">
                            {wLabel}%
                          </div>
                        ) : null}
                      </div>
                      <div style={{ width: `${d}%` }} className="relative bg-slate-300 dark:bg-slate-500">
                        {d >= 12 ? (
                          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-black">
                            {dLabel}%
                          </div>
                        ) : null}
                      </div>
                      <div style={{ width: `${b}%` }} className="relative bg-black">
                        {b >= 12 ? (
                          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white">
                            {bLabel}%
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          {data?.queuePosition != null ? (
            <div className="mt-2 text-[10px] opacity-60">Queue: {data.queuePosition}</div>
          ) : null}
        </>
      )}
    </div>
  )
}


import type { EngineEval } from '../lib/stockfishClient'

/** Vertical bar: white on top, black on bottom; divider height reflects White-positive cp (Stockfish convention). */
export function EvalBar({ eval: ev, className = '' }: { eval: EngineEval | null; className?: string }) {
  const pctWhiteFromTop = evalToWhitePct(ev)

  return (
    <div
      className={[
        'relative w-3 shrink-0 overflow-hidden rounded-sm border border-[var(--border)]',
        className,
      ].join(' ')}
      title={ev?.mate != null ? `Mat en ${ev.mate}` : ev?.cp != null ? `${(ev.cp / 100).toFixed(2)} pions (blancs +)` : ''}
      aria-hidden
    >
      <div className="absolute inset-0 bg-black" />
      <div
        className="absolute inset-x-0 top-0 bg-white transition-[height] duration-200"
        style={{ height: `${pctWhiteFromTop}%` }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 border-b-2 border-amber-500/90"
        style={{ top: `${pctWhiteFromTop}%`, transform: 'translateY(-1px)' }}
      />
    </div>
  )
}

/** Map eval to 0–100 % height of white segment from the top. */
function evalToWhitePct(ev: EngineEval | null): number {
  if (!ev) return 50
  if (ev.mate != null) {
    const m = ev.mate
    if (m > 0) return 95
    if (m < 0) return 5
    return 50
  }
  if (ev.cp == null) return 50
  const cp = ev.cp
  const x = Math.tanh(cp / 350)
  return clampPct(50 + 45 * x)
}

function clampPct(n: number) {
  return Math.max(5, Math.min(95, n))
}

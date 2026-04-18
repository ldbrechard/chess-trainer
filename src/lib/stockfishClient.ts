/** Stockfish 17.1 lite (single-thread WASM) via UCI in a dedicated Web Worker. */

export type EngineEval = {
  cp?: number
  mate?: number
}

function stockfishWorkerUrl(): string {
  const base = import.meta.env.BASE_URL
  const prefix = base.endsWith('/') ? base : `${base}/`
  return new URL(`${prefix}stockfish/stockfish.js`, self.location.origin).href
}

function splitLines(raw: unknown): string[] {
  const s = typeof raw === 'string' ? raw : String(raw)
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function parseEvalFromUciOutput(text: string): EngineEval {
  let cp: number | undefined
  let mate: number | undefined
  for (const line of text.split(/\n/)) {
    if (!line.startsWith('info')) continue
    const cpM = line.match(/\bscore cp (-?\d+)\b/)
    if (cpM) cp = Number(cpM[1])
    const mateM = line.match(/\bscore mate (-?\d+)\b/)
    if (mateM) mate = Number(mateM[1])
  }
  return { cp, mate }
}

function formatEval(e: EngineEval | null): string {
  if (!e) return '…'
  if (e.mate != null) return `#${e.mate}`
  if (e.cp != null) {
    const pawns = e.cp / 100
    const sign = pawns > 0 ? '+' : ''
    return `${sign}${pawns.toFixed(1)}`
  }
  return '—'
}

export { formatEval }

export class StockfishBrowserEngine {
  private worker: Worker | null = null
  private initPromise: Promise<void> | null = null
  private chain: Promise<unknown> = Promise.resolve()

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(stockfishWorkerUrl(), { type: 'classic' })
    }
    return this.worker
  }

  private async init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const w = this.ensureWorker()
        await this.waitForLine(w, (l) => l === 'uciok', () => {
          w.postMessage('uci')
        })
        await this.waitForLine(w, (l) => l === 'readyok', () => {
          w.postMessage('isready')
        })
      })().catch((e) => {
        this.initPromise = null
        throw e
      })
    }
    await this.initPromise
  }

  /** Wait until a line satisfying `pred` appears (messages may bundle multiple lines). */
  private waitForLine(w: Worker, pred: (line: string) => boolean, firstPost?: () => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        w.removeEventListener('message', onMsg)
        reject(new Error('Stockfish: timeout'))
      }, 20000)

      const onMsg = (e: MessageEvent) => {
        for (const line of splitLines(e.data)) {
          if (pred(line)) {
            window.clearTimeout(timeout)
            w.removeEventListener('message', onMsg)
            resolve(line)
            return
          }
        }
      }

      w.addEventListener('message', onMsg)
      firstPost?.()
    })
  }

  private collectUntilBestmove(w: Worker, afterListen: () => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const lines: string[] = []
      const timeout = window.setTimeout(() => {
        w.removeEventListener('message', onMsg)
        reject(new Error('Stockfish: analyse timeout'))
      }, 25000)

      const onMsg = (e: MessageEvent) => {
        for (const line of splitLines(e.data)) {
          lines.push(line)
          if (line.startsWith('bestmove')) {
            window.clearTimeout(timeout)
            w.removeEventListener('message', onMsg)
            resolve(lines.join('\n'))
            return
          }
        }
      }

      w.addEventListener('message', onMsg)
      afterListen()
    })
  }

  /** Serialize all UCI traffic — one analysis at a time. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.then(
      () => {},
      () => {},
    )
    return next
  }

  async analyzeFen(
    fen: string,
    opts?: { depth?: number; movetimeMs?: number },
  ): Promise<EngineEval> {
    return this.locked(async () => {
      await this.init()
      const w = this.ensureWorker()
      const depth = opts?.depth ?? 12
      const movetime = opts?.movetimeMs ?? 450
      w.postMessage('ucinewgame')
      w.postMessage(`position fen ${fen}`)
      const out = await this.collectUntilBestmove(w, () => {
        w.postMessage(`go depth ${depth} movetime ${movetime}`)
      })
      return parseEvalFromUciOutput(out)
    })
  }

  dispose(): void {
    if (!this.worker) return
    try {
      this.worker.postMessage('quit')
    } catch {
      /* ignore */
    }
    try {
      this.worker.terminate()
    } catch {
      /* ignore */
    }
    this.worker = null
    this.initPromise = null
    this.chain = Promise.resolve()
  }
}

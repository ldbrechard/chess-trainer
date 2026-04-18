/**
 * Copies Stockfish 17.1 lite-single (WASM) into public/stockfish/ as stockfish.js + stockfish.wasm
 * so the Emscripten bundle finds stockfish.wasm next to the script (see npm package stockfish).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const srcDir = path.join(root, 'node_modules', 'stockfish', 'src')
const destDir = path.join(root, 'public', 'stockfish')

const jsSrc = path.join(srcDir, 'stockfish-17.1-lite-single-03e3232.js')
const wasmSrc = path.join(srcDir, 'stockfish-17.1-lite-single-03e3232.wasm')

if (!fs.existsSync(jsSrc) || !fs.existsSync(wasmSrc)) {
  console.warn('[copy-stockfish] Skip: stockfish lite-single files not found (run npm install).')
  process.exit(0)
}

fs.mkdirSync(destDir, { recursive: true })
fs.copyFileSync(jsSrc, path.join(destDir, 'stockfish.js'))
fs.copyFileSync(wasmSrc, path.join(destDir, 'stockfish.wasm'))
console.log('[copy-stockfish] Copied lite engine to public/stockfish/')

# Chess Trainer - Spécifications Globales

## Stack Technique
- Framework: React (Vite) + TypeScript
- Logic: Chess.js
- UI Board: Chessground
- State Management: Zustand (`src/stores/appShellStore.ts` pour la navigation shell ; le reste est encore majoritairement local à `BuildMode`)
- Storage: Dexie.js (Local) + Supabase (Remote)
- Tests: Vitest (`npm test`)

## Structure des données
- Repertoire: Ensemble de nodes (mouvements)
- Move: { id, fen, notation, comment, parentId, childrenIds[] }

## Règles de développement
1. Prioriser la performance (éviter les re-renders inutiles de Chessground).
2. Code modulaire : Séparer la logique d'échecs (chess.js) de la vue.
3. Accessibilité hors-ligne via Service Workers.
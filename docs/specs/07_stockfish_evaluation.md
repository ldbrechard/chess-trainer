# Spec — Évaluation Stockfish (build)

## Objectif

Fournir une analyse de position **locale** en mode Build via **Stockfish.js 17.1**, variante **lite single-threaded** du paquet npm `stockfish` (WASM ~7 Mo, pas de `SharedArrayBuffer` / en-têtes COOP/COEP).

## Composants

1. **Assets** (`public/stockfish/`)
   - `stockfish.js` : bundle Emscripten (copié depuis `node_modules/stockfish/src/stockfish-17.1-lite-single-03e3232.js`).
   - `stockfish.wasm` : binaire WASM (copié depuis le fichier `-lite-single-*.wasm` renommé). Le moteur charge par défaut `stockfish.wasm` dans le même répertoire que le script.

2. **Script post-install** (`scripts/copy-stockfish.mjs`)
   - Exécuté après `npm install` pour peupler `public/stockfish/` (fichiers volumineux ignorés par git).

3. **Client moteur** (`src/lib/stockfishClient.ts`)
   - Instancie un `Worker` pointant vers `/[BASE_URL]stockfish/stockfish.js`.
   - Protocole **UCI** par `postMessage(string)` ; réponses en chaînes (souvent une ligne par message).
   - Séquence d’init : `uci` → attente `uciok` → `isready` → `readyok`.
   - Analyse : `ucinewgame` (optionnel), `position fen <FEN>`, `go depth <n> movetime <ms>`.
   - Lecture du dernier `score cp` ou `score mate` dans les lignes `info` avant `bestmove`.

4. **UI Build**
   - Bouton **cerveau** : active / désactive l’analyse ; à la désactivation, le worker est terminé.
   - **Texte d’évaluation** pour la position courante (centipions ou `#mate`).
   - **Barre verticale** blanc / noir : avantage blanc en haut, noir en bas (score interprété en perspective **Blancs + / Noirs −**).
   - **Arbre d’ouverture** : pour chaque coup suggéré (UCI), évaluation de la position **après** ce coup (FEN dérivée avec `chess.js`), affichage compact à côté du SAN.

## Paramètres par défaut

- Profondeur cible : **12** ; `movetime` : **400 ms** (position courante), **300 ms** (coups explorer — file séquentielle pour limiter la charge CPU).
- `MultiPV` : 1.

## Limitations

- Premier chargement WASM perceptible ; analyse séquentielle sur la liste explorer pour éviter de saturer le worker.
- Pas d’analyse en mode Train (hors scope).
- Licence **GPL** du moteur : redistribution conforme au paquet upstream.

## Évolutions possibles

- Réglages utilisateur (profondeur / temps).
- File d’attente annulable sur changement de FEN avant fin de `go`.
- Variante Chess960 si le répertoire le supporte (`UCI_Chess960`).

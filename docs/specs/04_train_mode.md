# Spécifications : Mode "Train" (v1)

## Objectif
Permettre à l’utilisateur de **s’entraîner** sur un répertoire existant.

Principe :
- L’utilisateur joue les coups de **sa couleur** (le `side` du répertoire).
- L’application joue automatiquement les coups de l’**adversaire** (selon l’arbre du répertoire).
- Si l’utilisateur joue un coup qui ne correspond pas au répertoire, l’application l’indique.
- L’utilisateur peut révéler le coup attendu via un bouton **“Show move”**.

Le mode Train ne modifie pas le répertoire en v1 (lecture seule).

## Pré-requis
- Un répertoire doit être **sélectionné** (existant dans Dexie).
- Les coups du répertoire sont stockés dans `moves` (SAN + FEN).

## Définitions
- **Côté joué**: `repertoire.side` ∈ {`white`, `black`}
- **Couleur jouée**: la couleur de `repertoire.side`
- **Couleur adverse**: l’autre couleur
- **Position courante**: un node (move) ou la racine (parentId = null)
- **Coup attendu**: le (ou les) coup(s) enfant(s) autorisé(s) par le répertoire depuis la position courante.

## Navigation / Activation du mode
### Toggle Build / Train
Depuis l’UI quand un répertoire est sélectionné :
- Un bouton **Build** et un bouton **Train** (ou un toggle) permet de changer de mode.
- Le changement de mode conserve :
  - le `activeRepertoireId`
  - la position courante (option v1.1)

En v1, on peut choisir simple :
- passer en Train remet à **la racine**.

## UX (v1)

### Écran Train
Composants :
- **Board** interactif (l’utilisateur ne peut jouer que quand c’est à sa couleur)
- **Status**:
  - “À toi de jouer” / “Réponse de l’adversaire…” / “Incorrect”
- Boutons :
  - **Back** (revenir au parent)
  - **Root** (revenir à la racine)
  - **Show move** (révéler le coup attendu quand c’est à l’utilisateur de jouer)
  - (option) **Retry** (revenir à la position où l’erreur a eu lieu)
- **Variantes (adverse)**:
  - quand c’est à l’adversaire de jouer et qu’il existe plusieurs variantes, la v1 doit définir la stratégie (voir R4).

Feedback visuel minimal :
- un message (toast/inline) “Correct” / “Incorrect”
- en cas d’erreur, possibilité de révéler le coup attendu.

## Règles métier

### R1 — Source de vérité
Le mode Train est **lecture seule** :
- aucun `addMove` en DB
- aucune modification de `moves`/`repertoires`

### R2 — Coups autorisés pour l’utilisateur
- L’utilisateur ne peut jouer que quand `chess.turn()` correspond au `repertoire.side`.
- À cette position, les coups **valides** sont les coups enfants existants dans l’arbre :
  - même `repertoireId`
  - `parentId = currentNodeId`
  - SAN égal à la SAN produite par `chess.js` pour le coup joué

### R3 — Validation du coup utilisateur
Quand l’utilisateur joue un coup :
1. Vérifier la légalité (via `chess.js`)
2. Calculer la SAN (`move.san`) et la FEN après coup
3. Récupérer la liste des coups enfants depuis la position courante
4. Si la SAN matche un enfant :
   - le coup est **correct**
   - avancer la position courante vers ce node
   - déclencher la réponse adverse automatique (R4)
5. Sinon :
   - le coup est **incorrect**
   - l’app affiche un message “Incorrect”
   - l’app reste sur la même position (snapback)
   - `Show move` devient pertinent

### R4 — Réponse automatique de l’adversaire
Quand c’est au tour de l’adversaire de jouer (après un coup correct utilisateur, ou en entrant dans une position adverse) :
- L’app choisit automatiquement un coup enfant adverse et l’applique.

Stratégie v1 (à choisir) :
- **Option A (déterministe)**: si plusieurs variantes adverses, choisir la première (tri par `id` asc).
- **Option B (aléatoire)**: choisir une variante au hasard (uniforme) pour varier l’entraînement.

Recommandation v1: **Option B**, avec un seed simple, ou `Math.random()`.

Si aucun coup adverse n’existe :
- la ligne d’entraînement s’arrête (statut “Fin de ligne”).

### R5 — “Show move”
Le bouton **Show move** :
- est actif uniquement quand c’est à l’utilisateur de jouer **et** qu’au moins un coup enfant existe
- affiche le coup attendu :
  - si un seul: montrer la SAN attendue
  - si plusieurs (rare côté joué car en Build on impose 1 réponse): afficher la liste

Comportement au clic :
- v1: révéler seulement (texte)
- v1.1: possibilité de “jouer automatiquement” le coup révélé

## Données / Requêtes nécessaires
Pour une position `(repertoireId, parentId)` :
- `listChildrenMoves({ repertoireId, parentId })` pour obtenir les variantes disponibles.

## État applicatif attendu (v1)
État minimal Train :
- `mode: 'build' | 'train'`
- `activeRepertoireId`
- `currentNodeId` (null = racine)
- `path` (breadcrumb)
- `children` (coups enfants depuis currentNodeId)
- `status` (idle / waiting_user / waiting_opponent / incorrect / finished)
- `revealedMove?: string | string[]`

## Critères d’acceptation (v1)
- Je peux passer en **Train** via un bouton quand un répertoire est sélectionné.
- L’ordinateur joue automatiquement les coups de l’adversaire (selon l’arbre).
- Si je joue un coup incorrect, l’app l’indique et le coup n’est pas appliqué.
- Le bouton **Show move** révèle le coup attendu.
- Je peux naviguer `Back` / `Root` sans modifier la DB.


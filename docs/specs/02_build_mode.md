# Spécifications : Mode "Build" (v1)

## Objectif
Permettre à l’utilisateur de **construire** un répertoire d’ouvertures sous forme d’**arbre de coups** (variantes), stocké en **offline-first** dans IndexedDB via **Dexie**.

Le mode Build doit permettre :
- de **créer** un répertoire (nom + côté joué),
- de **jouer des coups** et **enregistrer** les nouveaux coups,
- de **parcourir** l’arbre (revenir en arrière, choisir une variante),
- de respecter les règles : **1 seule réponse** pour la couleur “jouée”, **variantes illimitées** pour l’adversaire.

Références :
- Stockage : `03_storage_local.md`
- Architecture globale : `01_architecture.md`

## Définitions
- **Côté joué** (`side`) : `'white' | 'black'` choisi à la création du répertoire.
- **Couleur jouée** : la couleur du `side` du répertoire.
- **Couleur adverse** : l’autre couleur.
- **Node / Move** : un coup stocké dans la table `moves`, lié à un `repertoireId` et un `parentId`.
- **Racine** : état initial (position FEN de départ). Le premier coup a `parentId = null`.

## Modèle de données (Dexie)
Conforme à `03_storage_local.md`.

### `repertoires`
- `++id`
- `title` (string)
- `side` ('white' | 'black')
- `createdAt` (number)

### `moves`
- `++id`
- `repertoireId` (number)
- `parentId` (number | null)
- `fen` (string) : **position après le coup**
- `notation` (string) : SAN (ex: `e4`, `Nf3`)
- `comment` (string)
- `eval?` (number)

## UX / Écrans (v1)

### 1) Liste des répertoires
- Affiche les répertoires existants (titre, side, date).
- CTA : **“Nouveau répertoire”**.
- Action : ouvrir un répertoire → passer en écran **Build** (éditeur).

### 2) Création d’un répertoire (modal ou page)
Champs requis :
- **Nom** du répertoire (`title`)
- **Côté joué** (`side`): Blancs / Noirs

Validation :
- `title` non vide, trimé, longueur max (ex: 80).
- `side` obligatoire.

Résultat :
- Création d’une ligne dans `repertoires`
- Redirection vers l’écran **Build** du répertoire nouvellement créé.

### 3) Écran Build (éditeur d’arbre)
Composants requis (v1) :
- **Board** interactif (déplacements légaux)
- **Breadcrumb / chemin** depuis la racine (liste des coups joués)
- **Navigation** :
  - bouton **Back** (revenir au parent)
  - liste des **variantes disponibles** depuis la position courante (coups enfants)
  - clic sur une variante → la jouer (charger la branche)
- **Panneau “Répertoire”** : titre + side + position courante (FEN)

## Règles métier (v1)

### R1 — Ajout d’un coup au répertoire
Quand l’utilisateur joue un coup sur l’échiquier en mode Build :
1. Le coup doit être **légal** (géré par `chess.js`).
2. On calcule la **SAN** du coup et la **FEN après le coup**.
3. On cherche si, depuis le **node courant** (parent), un coup enfant existe déjà :
   - même `repertoireId`
   - même `parentId`
   - même `notation` (SAN)
   - (optionnel v1.1) ou même `fen` pour détection de transposition.
4. Si le coup n’existe pas → **il est ajouté** dans `moves`.
5. On avance la position courante vers ce node (nouveau ou existant).

### R2 — Contrainte “1 seule réponse” pour la couleur jouée
Soit `side` le côté joué du répertoire.

Depuis une position donnée, on définit **à qui est le trait** via `chess.js.turn()` :
- Si c’est **au côté joué** de jouer : **un seul coup enfant autorisé** depuis ce parent.
- Si c’est à l’**adversaire** de jouer : **variantes illimitées** (plusieurs coups enfants possibles).

Comportement attendu si la contrainte bloque un ajout :
- Si l’utilisateur tente de jouer un 2e coup différent alors que c’est au côté joué : le système **n’ajoute pas** de nouveau move.
- UX v1 : afficher un message simple (toast/alerte inline) : “Une seule réponse est autorisée pour ta couleur à cette position.”
- Le coup peut tout de même être joué “temporairement” sur le board, mais la source de vérité doit rester l’arbre ; en v1 on privilégie : **refuser** et **revenir** à la position courante.

### R3 — Navigation dans l’arbre
L’utilisateur peut :
- **Revenir en arrière** (parent)
- **Choisir une variante** parmi les enfants (jouer un autre enfant du même parent)
- **Revenir à la racine** (reset)

La navigation **ne modifie pas** les données, elle change seulement :
- la **position courante** (node courant)
- l’état `chess.js` / FEN affichée
- le chemin (breadcrumb)

### R4 — Persistance
Toute création doit être persistée immédiatement dans Dexie :
- création de répertoire
- ajout de move

Pas de synchronisation réseau en v1 (prévue par `03_storage_local.md`).

## API interne attendue (pour implémentation)

### Store / State (Zustand recommandé)
État minimal :
- `activeRepertoireId: number | null`
- `activeSide: 'white' | 'black' | null`
- `currentNodeId: number | null` (null = racine)
- `currentFen: string` (FEN courante)
- `path: Array<{ moveId: number; notation: string }>` (breadcrumb)
- `children: Move[]` (variantes depuis `currentNodeId`)

Actions minimales :
- `createRepertoire(title, side) -> id`
- `loadRepertoire(id)`: charge le répertoire + se place à la racine
- `playOrAddMove(from, to, promotion?)`: applique règles R1/R2
- `goBack()`, `goToRoot()`
- `selectVariant(moveId)` : navigue vers l’enfant sélectionné

### Conventions chess.js / chessground
- Source de vérité règles/état : `chess.js`
- `chessground` reçoit :
  - `fen`
  - `movable.dests` calculées depuis `chess.js`
  - `turnColor` selon `chess.js.turn()`

## Cas limites (v1)
- **Promotion** : par défaut en dame (comme actuellement), UI de choix en v1.1.
- **Coup illégal** : refusé, pas d’écriture en DB.
- **Répertoire vide** : aucun coup à la racine, l’utilisateur doit pouvoir jouer le 1er coup.
- **Suppression/édition** : hors scope v1 (ajout uniquement).

## Critères d’acceptation (v1)
- Je peux créer un répertoire avec **nom** + **côté**.
- En mode Build, je peux jouer des coups ; un nouveau coup est **persisté** s’il n’existe pas.
- La contrainte “**1 seule réponse** pour ma couleur” est appliquée.
- Je peux **naviguer** : revenir en arrière, choisir une autre variante adverse, revenir à la racine.


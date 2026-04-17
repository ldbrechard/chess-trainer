# Spécifications : Intégration Lichess Explorer

## Objectif
Afficher les statistiques de la base de données Lichess pour aider à la construction du répertoire.

## Source de données
- API : `https://explorer.lichess.ovh/lichess`
- Rafraîchissement : À chaque changement de FEN dans le store.

## Fonctionnalité : Arbre d’ouverture (Mode Build)

### Besoin utilisateur
Dans une position (FEN) donnée, afficher :
- **Les coups les plus joués** (SAN) + **nombre de parties**.
- **Le score Blanc / Nul / Noir** sous forme d’une **barre** segmentée (blanc / gris clair / noir) proportionnelle.
- Un **filtre ELO** basé sur les tranches proposées par Lichess.

### UI (implémentée)
- Un bloc **“Arbre d’ouverture (Lichess)”** **sous l’échiquier** (mode Build).
- Le bloc est **repliable/dépliable** (collapsed).
- Filtre ELO via **un seul range slider à deux bornes** (min/max) basé sur les buckets Lichess : 1600 / 1800 / 2000 / 2200 / 2500.
- Liste des coups avec :
  - **SAN**
  - **Nombre total** (white + draws + black)
  - **Barre W/D/B** avec **contour** et **% affichés dans la barre** (si segment assez large).
  - Chaque coup est **cliquable** : clic = jouer le coup (via UCI).

### API utilisée
Endpoint :
- `GET https://explorer.lichess.ovh/lichess`

Paramètres (utilisés) :
- `fen` : FEN de la position courante.
- `variant=chess`
- `moves=12` : limite du nombre de coups renvoyés.
- `ratings=1600,1800,2000,2200,2500` : buckets ELO sélectionnés (liste séparée par des virgules).

### Authentification (temporaire / dev)
Depuis **mars 2026**, `explorer.lichess.ovh` renvoie **HTTP 401** sans authentification.  
Choix actuel (temporaire) : **Personal Access Token** côté frontend via variable d’environnement :
- `VITE_LICHESS_TOKEN` dans `.env` (fichier ignoré par git)
- Requête avec header `Authorization: Bearer <token>`

### Réponse attendue (partiel)
Champs utilisés :
- `opening` : `{ eco, name }` (optionnel)
- `moves[]` : `[{ uci, san, white, draws, black, ... }]`
- `queuePosition` (optionnel)

### Contraintes & robustesse
- **Debounce** sur les changements de FEN/filtre (≈ 220ms) pour limiter les appels.
- **AbortController** pour annuler les requêtes en vol lors d’un changement rapide de position.
- **Cache en mémoire côté client** (clé = `fen + ratings`) pour éviter de refetch les mêmes positions dans la session.
- Gestion d’erreur simplifiée avec message dédié si **HTTP 429** (rate limiting) :
  - Le service `explorer.lichess.ovh` peut être temporairement indisponible / limité.

### Fichiers
- UI & fetch : `src/features/build/OpeningExplorer.tsx`
- Intégration en Build : `src/features/build/BuildMode.tsx`
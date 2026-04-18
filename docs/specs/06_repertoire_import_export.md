# Spécifications : Import / export de répertoires

## Objectif

Permettre d’**importer** un arbre de coups depuis un **PGN** (fichier ou URL d’étude Lichess publique) et d’**exporter** un répertoire existant en **PGN** téléchargeable, avec une entrée **Partager** (UI préparée, canaux à implémenter plus tard).

## Home

- Bouton **« Importer un répertoire »** ouvrant un flux en modal (ou overlay) dédié.
- Chaque ligne de répertoire affiche à droite deux actions discrètes :
  - **Téléchargement** : export PGN du répertoire.
  - **Partage** : ouvre un panneau d’options (mail, app native, Facebook, WhatsApp) **toutes grisées** pour l’instant.

## Import — étape source

Deux entrées :

1. **Upload PGN** : champ fichier `.pgn` / texte.
2. **URL d’étude Lichess** : champ texte ; formats acceptés (public) :
   - `https://lichess.org/study/<studyId>`
   - `https://lichess.org/study/<studyId>/<chapterId>` (chapitre unique)
   - variantes avec `www.`, fragment `#…`, etc. (normalisation côté parseur d’URL).

### Aide (infobulle)

- Icône **point d’interrogation** à côté du titre ou du bloc source.
- Au **survol** : infobulle expliquant comment obtenir un PGN depuis **chess.com** et **Lichess** (export / copier PGN / étude publique).

### Validation visuelle

- **Vert** : contenu PGN ou URL résolue **parsable** et contenant **au moins un coup** jouable depuis la (les) position(s) de départ.
- **Rouge** : message d’erreur explicite (parse, réseau, CORS, étude privée, etc.).

## Import — étape prévisualisation

Après validation réussie :

- **Statistiques** (sur l’union des parties du fichier) :
  - **Chapitres** : nombre de jeux PGN distincts (`parseGames`).
  - **Coups** : nombre total de demi-coups importés (toutes branches).
  - **Variantes** : nombre de **feuilles** (positions terminales sans continuation) dans la forêt importée.
- **Couleur** : choix Blancs / Noirs (métadonnée répertoire, comme à la création manuelle).
- **Titre** : prérempli (ex. tag `Event` du premier jeu, ou titre dérivé de l’URL / nom de fichier), **modifiable** (longueur max alignée sur la création manuelle, ex. 80 caractères).

Bouton **Valider** : création du répertoire + insertion en masse des coups + sync planifiée comme pour le build manuel.

## Export PGN

- Fichier `.pgn` avec en-têtes minimaux (`Event`, `Site`, date, orientation si utile).
- Encodage des **variantes** : première branche sœur (tri `createdAt` puis `id`) = **ligne principale** ; les autres branches en parenthèses standard PGN.
- Les transpositions (même FEN depuis plusieurs parents) ne sont pas fusionnées : export fidèle à la structure stockée.

## Partage (placeholder)

- Actions **mail**, **application**, **Facebook**, **WhatsApp** : visibles mais **désactivées** + style grisé ; pas d’URL générée pour l’instant.
- Évolution prévue : lien profond / fichier temporaire / intent natif selon la plateforme.

## Technique

- Parse : `@mliebelt/pgn-parser` (`parseGames`).
- Validation des coups : `chess.js` sur chaque branche.
- Fetch Lichess : `GET` sur la **même URL que la page étude / chapitre**, en ajoutant simplement **`.pgn`** au chemin (ex. `…/study/<id>.pgn` ou `…/study/<id>/chapter/<id>.pgn`). Requête **directe** vers `lichess.org` (pas de proxy : évite les erreurs gateway). Si CORS bloque, message invitant à télécharger le PGN puis « Upload PGN ».

## Fichiers (référence)

- Spec : `docs/specs/06_repertoire_import_export.md`
- Logique PGN / stats : `src/lib/pgnImportExport.ts`
- Fetch URL : `src/lib/lichessStudyPgn.ts`
- UI import : `src/features/repertoire/ImportRepertoireModal.tsx`
- Repo : `bulkInsertMovesForRepertoire` dans `src/db/repertoireRepo.ts`
- Intégration liste : `src/features/build/BuildMode.tsx`

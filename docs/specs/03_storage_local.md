# Spécifications : Stockage Local (Dexie.js)

## Objectif
Permettre une utilisation "Offline-first". Toutes les modifications sont d'abord enregistrées dans le navigateur de l'utilisateur via IndexedDB.

## Schéma Dexie.js
L'application utilisera une base de données nommée `ChessTrainerDB`.

### Table `repertoires`
- `++id`: ID auto-incrémenté.
- `title`: Nom du répertoire (ex: "E4 White Repertoire").
- `side`: 'white' | 'black'.
- `createdAt`: Timestamp.

### Table `moves`
C'est la table cruciale pour l'arbre d'ouvertures.
- `++id`: ID auto-incrémenté.
- `repertoireId`: Clé étrangère vers `repertoires.id`.
- `parentId`: ID du coup précédent (null pour le premier coup).
- `fen`: La position après le coup (utilisée pour détecter les transpositions).
- `notation`: Notation SAN (ex: "e4", "Nf3").
- `comment`: Texte libre pour les annotations.
- `eval`: Score Stockfish (optionnel).

## Logique de synchronisation (Architecture cible)
1. L'application lit/écrit toujours dans Dexie.
2. Un "hook" de synchronisation surveille les changements et les pousse vers Supabase quand le réseau est disponible.

## Exigences de code
- Utiliser les types TypeScript pour chaque table.
- Créer un fichier `src/db/schema.ts` pour centraliser la configuration de Dexie.
# Puzzle Mode Spec

## Goal

Offer puzzle training linked to the currently selected repertoire variant, using Lichess opening tags as the puzzle matching key.
Only **useful tags** (known to exist in `puzzles_v2`) are retained by the matching pipeline.

## User Flow

1. User is in session view and clicks `Puzzles`.
2. A single popup appears:
   - an "Ouvertures detectees" box listing detected opening tags,
   - fixed scope notice: `Variante actuelle`,
   - actions: `Demarrer` / `Annuler`.
3. On start, puzzle mode launches with:
   - puzzle board,
   - difficulty filter buttons (`Facile`, `Moyen`, `Difficile`),
   - `Puzzle suivant`,
   - `Montrer le coup` (green arrow hint),
   - clickable session history chips (green check / red cross).

## Opening Tag Selection Algorithm

Input: currently selected position in move tree.

### Useful vs. non-useful tags

- A "useful tag" is a tag present in the curated useful-tag list built from puzzle DB counts.
- Any detected opening not in that list is considered non-useful.
- Non-useful tags are normalized to the nearest useful ancestor tag (by removing trailing `_...` segments).
- If no useful ancestor exists, the tag is discarded.
- The current implementation also performs a live fallback check in puzzle DB:
  - if a tag is not in the curated static list, it is tested against DB (`count > 0` equivalent),
  - if it exists in DB, it is treated as useful even when absent from the static subset.

### 1) Current position without direct opening

If the selected position has no useful opening from Lichess Explorer:

- walk upward through parent positions,
- stop at the first ancestor with a **useful** opening,
- use that single latest known useful tag.

### 2) Current position with an opening

If the selected position has a useful opening:

- traverse each descendant branch from that position,
- continue while:
  - there are moves, and
  - positions still have a useful opening tag,
- collect **all useful tags encountered in descendants** (not only branch last tags),
- include the current position useful tag itself,
- final tag set = union of all collected useful tags.

### Implementation Notes

- Opening source: `https://explorer.lichess.ovh/lichess` with `moves=0`.
- Normalize opening names to canonical tags by:
  - removing diacritics,
  - replacing non-alphanumeric groups with `_`,
  - trimming `_`.
- Normalize canonical tags to useful tags before using them for puzzle lookup.
- Use cached opening results per FEN during a session.
- Cap deep branch exploration to avoid excessive API calls.

## Puzzle Selection Rules

- Query source table: `public.puzzles_v2`.
- Keep only puzzles where side to move matches repertoire side:
  - repertoire `white` => puzzle `playerTurn = 'w'`,
  - repertoire `black` => puzzle `playerTurn = 'b'`.
- Prefer unseen puzzles using local played-id history (localStorage).
- If no unseen candidate remains, allow replay from already seen set.

## Session Result Rules

- Wrong move does **not** auto-skip to next puzzle.
- User may retry until solved.
- If puzzle was ever failed, result stays failed (red cross), even if later solved.
- Using `Montrer le coup` marks puzzle as failed immediately, but user can continue.
- History chips are clickable to jump back to a played puzzle.
- Replaying past puzzle does not create duplicate chip.
- Progress frontier is preserved:
  - jumping back and replaying puzzle `N` continues next on first unseen frontier (e.g. to `N+2` if already progressed).

## UI/UX Details

- Hint display = green arrow auto-shape on board (no textual solution popup).
- Session timer:
  - current puzzle elapsed time,
  - session average puzzle duration.


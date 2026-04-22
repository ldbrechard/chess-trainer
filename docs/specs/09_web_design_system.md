# Web Design System (Desktop)

This document defines the web-only design system and layout rules for Opening Grinder.
Mobile UX is intentionally left unchanged.

## Implemented Directions

### 1) High Contrast (Analytical Monolith)
- Mode: deep dark.
- Background: `#0D0E10`.
- Primary accent: `#2346D5`.
- Typeface: `Inter`.
- Geometry: sharp, compact, radius around `4px` to `10px`.

### 2) Soft Pro (Lumina Gambit / Modern Study)
- Mode: soft light.
- Background: `#F8FAFC` with white surfaces.
- Primary accent: `#4338CA`.
- Typeface: `Manrope`.
- Geometry: softer cards, radius around `8px` to `12px`.

## Shared Web Layout

Desktop keeps a shared information architecture based on the approved mockups:
1. Global top bar (full width):
   - left: logo + app title
   - right: unified sync + profile container
2. Left side menu (persistent):
   - Home
   - Build
   - Statistics
   - Settings
   - no creation CTA in the sidebar (creation actions stay in Home content)
3. Main content area:
   - Home dashboard
   - Build workspace

## Home Layout (Mockup-Aligned)

- Current focus card:
  - uses the last opened repertoire
  - compact width (content-sized, not full-row stretched)
  - exposes quick actions: Train / Puzzles
  - displays mastery + positions with reduced typography
- Repertoire cards:
  - title + optional short description (small italic)
  - mastery percentage
  - positions count (not variations)
  - max depth
  - last train date
  - FSRS due count (moves pending proxy)
- Footer actions in dashboard zone:
  - create repertoire
  - import repertoire
  - explore repertoires

## Build Layout (Mockup-Aligned)

- Header row inside content:
  - current active repertoire selector
  - Train and Puzzles actions
- 3-column workspace:
  - Move tree / notes area
  - Board area with:
    - Stockfish mini-panel next to the board (on/off icon + eval bar)
    - annotation toolbar below board (horizontal)
    - move navigation buttons (start, previous, next, end)
  - Opening explorer area (without Stockfish header card)
  - Analysis column with move metadata and clickable NAG icon bar

## Current Implementation Scope

- Added web theme switch in settings:
  - `Soft Pro (Lumina Gambit)`
  - `High Contrast (Analytical Monolith)`
- Added desktop-scoped theme tokens through `web-shell` wrappers in CSS.
- Implemented mockup-aligned global shell:
  - top bar + persistent left side menu
  - Home and Build pages rendered inside the same shell
- Implemented mockup-aligned Home and Build functional deltas listed above.

## Guardrails

- New web modules should consume existing CSS variables (`--bg`, `--text`, `--accent`, etc.).
- New mobile modules must not be forced to adopt the web shell.
- Keep this file updated whenever:
  - new web primitives are introduced,
  - token names change,
  - layout hierarchy is modified.

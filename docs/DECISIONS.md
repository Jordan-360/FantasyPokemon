# Decisions Log

## 2026-10-13: Fantasy league sim, not a playable football game

**Decision:** Build an ESPN-style fantasy league where weekly results are simulated.
**Why:** A playable football game is far beyond scope. The fantasy format keeps
the fun parts (drafting, lineups, standings) at a size one person can finish.
**Alternatives:** Wii Sports-style playable game (dropped as too complex).

## 2026-10-13: React + Vite + TypeScript

**Decision:** React with TypeScript, scaffolded by Vite.
**Why:** React matches my portfolio direction. TypeScript catches shape errors
across the many data types (Pokémon, NFL player, mapping, team, league).
**Alternatives:** Plain JS (less safety), Angular (already on my resume).

## 2026-10-13: No backend or database (for now)

**Decision:** League state lives in localStorage behind an async storage module.
**Why:** Single-player game, so no shared data. A database adds cost and complexity
with no benefit yet. The async storage module makes a later swap to a hosted
database (e.g. Supabase) a one-module change.
**Alternatives:** Supabase/Postgres from day one (deferred until multiplayer
or cross-device saves are wanted).

## 2026-10-13: Static generated data

**Decision:** Scripts pull from PokeAPI and Sleeper's public API and save
static JSON into src/data/.
**Why:** Reference data changes about once a season. Static JSON loads instantly
and keeps the app free of runtime API dependencies.
**Alternatives:** Live API calls at runtime (slower, fragile).

## 2026-10-13: Hybrid Pokémon-to-player matching

**Decision:** Base stats decide each Pokémon's position. Within a position,
Pokémon are ranked by fit and mapped to NFL players in rank order.
**Why:** Positions feel earned from stats, and rank order guarantees a sensible
spread of talent.
**Alternatives:** Pure stat-similarity matching, or straight rank order by
base stat total.

## 2026-10-13: Game logic separated from UI

**Decision:** All rules live in src/engine/ as pure TypeScript.
**Why:** Testable without rendering, easier to reason about, and the UI can
change freely.

# FantasyPokemon

An ESPN-style fantasy football league where every player is a Pokémon.
704 Pokémon (Gens 1–6) are each paired with a real NFL starter and inherit
that player's position and real weekly production. Draft against 9 CPU
managers, set lineups, and play out the 2026 season with real NFL stats plus a
Pokémon layer (type matchups, evolution). Full game rules: docs/SPEC.md.

Portfolio + learning project: production-grade habits, React + TypeScript fluency.

## Tech stack

- React + Vite + TypeScript
- Plain CSS
- State: React's built-in useState/useContext
- Persistence: localStorage via src/storage/ (async API, database-ready)
- No backend, no database (deliberate; see docs/DECISIONS.md)

## Working agreement (IMPORTANT)

- I write the code myself. Do NOT generate full components, functions,
  or solutions unless I explicitly ask you to.
- Default mode: review, explain, point out bugs/issues, ask me
  leading questions; don't just hand me the fix.
- If I'm stuck and ask for a solution, explain the _reasoning_ first,
  then show minimal code, not a full rewrite.
- Flag anti-patterns and explain _why_, not just _what_.
- Use Conventional Commits for commit message suggestions
  (feat:, fix:, chore:, docs:, refactor:).

## Architecture rules

- src/engine/ is pure TypeScript: no React imports, no storage calls.
- Nothing outside src/storage/ touches localStorage directly.
- Storage functions are async even though localStorage is sync.
- Generated JSON in src/data/ is produced by scripts/ and never hand-edited.

## Folder structure

scripts/ # data scripts (pairing, weekly points refresh)
src/
components/ # UI
hooks/ # custom hooks
data/ # generated JSON + constants
engine/ # draft, schedule, simulation
storage/ # persistence layer
types/ # shared types

## Data sources

- PokeAPI: base stats, types, evolution chains for Pokémon #1–721
- nflverse: depth charts, weekly player/team stats, schedules
- EA Madden NFL 27 ratings (joined by hand into pairs.json; no public API)

## Data shapes

- `types/pair.ts`: `RawPair` (pairs.json entry: Pokémon + `nfl` player, keyed by `id` '001'), `Pair` adds `projectedPPG`
- `types/dst.ts`: `RawDstUnit` (team, 12 member pair ids, `dominantType`), `DstUnit` adds `projectedPPG` + avg `maddenOvr`
- `types/points.ts`: `WeeklyPointsFile` (`weeks['1'].players[gsisId]` / `.dst[team]`), `ProjectionsFile`
- `types/draft.ts`: `Draftable` (offense pair or `DST-<team>`), `DraftState` (settings, snake `order`, `picks`)
- Load data through `src/data/loaders.ts`; engine functions take data as arguments

## Commands

- `npm run dev`: start dev server
- `npm run build`: production build
- `npm test`: run Vitest once (`npm run test:watch` to watch)
- `npm run refresh:points`: pull nflverse stats, regenerate weekly_points.json + projections.json (`-- --offline` uses .cache/)
- `npm run lint`: run ESLint
- `npm run format`: format with Prettier
- `npm run format:check`: check formatting

## Tooling

- ESLint (Vite's TS config) + eslint-config-prettier
- Prettier (no semicolons, single quotes, 2-space tabs, LF endings)
- Husky + lint-staged pre-commit hook
- .gitattributes forces LF line endings

## Git workflow

- `main` stays stable
- Feature branches for real work (feature/data-scripts), merged via PR
- Conventional Commits

## Reference docs

- docs/DECISIONS.md: why things are built the way they are

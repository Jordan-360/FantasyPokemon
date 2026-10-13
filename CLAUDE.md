# FantasyPokemon

An ESPN-style fantasy football league where every player is a Pokémon.
Each of the original 151 Pokémon is mapped to a real NFL player and inherits
that player's position and rank. Draft a team against CPU managers, set
lineups, and simulate weeks to build a season record.

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

scripts/ # data-pull scripts (PokeAPI, Sleeper)
src/
components/ # UI
hooks/ # custom hooks
data/ # generated JSON + constants
engine/ # matching, draft, schedule, simulation
storage/ # persistence layer
types/ # shared types

## Data sources

- PokeAPI: base stats, types, sprites for Pokémon #1–151
- Sleeper public API: active NFL players, positions, rankings

## Data shapes

[Fill in as types are defined in src/types/]

## Commands

- `npm run dev`: start dev server
- `npm run build`: production build
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

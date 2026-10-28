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

## 2026-10-27: Gale-Shapley stable matching replaces hybrid rank-order

> **Superseded 2026-10-28** by "Fixed pairs from the planning handoff" below.
> The Gale-Shapley code was removed; it is still in git history.

**Decision:** Use the Gale-Shapley algorithm (Pokémon propose, players hold best offer)
to produce a stable one-to-one mapping between every Pokémon form and an active NFL player.
**Why stable matching:** The previous hybrid approach assigned Pokémon to positions greedily
by rank. A greedy pass can leave a better-fit Pokémon stranded once all good players at its
natural position are taken. Gale-Shapley guarantees no such "blocking pair" — no unmatched
Pokémon and player would both prefer each other over their current partners.
**Scoring (fitScore):** Four components, all normalized to [0, 1], weighted in one exported
config object so weights are easy to tune:

- **Stat score (60%):** position-specific base-stat weights (QB favors Sp. Atk + Sp. Def +
  Speed; WR favors Speed + Sp. Atk; DL favors HP + Defense + Attack; etc.). Divided by 255
  (max stat) to normalize.
- **Type affinity (10%):** binary bonus if the Pokémon's type matches the position (Psychic →
  QB, Fighting/Ground → RB, Flying/Electric → WR/CB, Rock/Steel → DL, etc.). Kept small so
  it tips ties rather than overriding stats.
- **Physical fit (15%):** Pokémon height (dm → inches) and weight (hg → lbs) compared to the
  position's mean body type via a Gaussian kernel in z-score space. Uses position-level means
  so big, heavy Pokémon naturally fit DL/TE and light, small Pokémon fit WR/CB.
- **Talent tier (15%):** normalized BST (base stat total) should align with normalized player
  rank (lower searchRank = better). Scored as 1 − |normalizedBST − playerTalent|, so legendary
  Pokémon land with elite players and weak ones land with backups.
  **Scope:** All Pokémon forms across all generations (Megas, regional variants, Gigantamax, etc.),
  globally matched against all active rostered NFL players (excluding OL, LS, P). Position on
  the output mapping comes from the matched player's NFL position.
  **Alternatives:** Greedy rank-order within pre-assigned position buckets (simpler but unstable
  and position distribution depends on assignment order).

## 2026-10-13: Game logic separated from UI

**Decision:** All rules live in src/engine/ as pure TypeScript.
**Why:** Testable without rendering, easier to reason about, and the UI can
change freely.

## 2026-10-28: Fixed pairs from the planning handoff

**Decision:** Replace the Gale-Shapley pipeline with the 704 fixed pairs in
`src/data/pairs.json` (rebuilt by `scripts/match_pairs.py`). The pool is every
NFL team's 22 depth-chart starters. Pokémon positions come from stat _shape_
via an optimal assignment (Hungarian algorithm), then pair rank-for-rank with
players by per-game production. Defensive Pokémon form a team D/ST
(`src/data/dst_units.json`) instead of being drafted on their own.
**Why:** Starters only means every pair is someone who actually scores. Fixed
slot quotas guarantee a balanced draft pool, and pairs stay fixed for a season.
**Alternatives:** Keep tuning `fitScore` weights (the old approach matched
against every rostered player, so many pairs were backups who never score).
**Note:** Madden ratings in `pairs.json` were joined by hand because EA has no
API. That breaks the "never hand-edit generated JSON" rule for this one file,
so don't regenerate it without re-joining Madden.

## 2026-10-28: Projections and weekly points are separate generated files

**Decision:** `scripts/refreshWeeklyPoints.ts` writes `src/data/weekly_points.json`
and `src/data/projections.json`. The loaders in `src/data/loaders.ts` join the
projections onto pairs and D/ST units as `projectedPPG`.
**Why:** `pairs.json` is fixed for the season, but stats change every week.
Keeping them in separate files means a weekly refresh never rewrites the pairs.
Each week stores `players` (by gsisId) and `dst` (by team) as separate maps
instead of one mixed map as SPEC §1 sketches, so the two id spaces can't collide.
**Scoring:** Offense uses nflverse `fantasy_points_ppr` (ESPN PPR). K and D/ST
use ESPN standard scoring, defined as constants in the script. D/ST "points
allowed" is the opponent's final score (ESPN leaves out points the offense
gave up; nflverse doesn't split that out).

## 2026-10-28: Draft engine guardrails beyond the spec

**Decision:** The CPU pick score follows SPEC §3. On top of that, the engine
(a) never picks a position whose need multiplier is 0, and (b) only fills
open starting slots once the picks left equal the slots left (K/D/ST still
wait for the final 2 rounds unless nothing else can fill a slot).
**Why:** VOR goes negative late in the draft, and `negative × 0` = 0 would
make a 3rd QB look better than any real option. Rule (b) guarantees the spec's
sanity checks (every slot filled, never 2 K or 2 D/ST) instead of just
hoping for them.

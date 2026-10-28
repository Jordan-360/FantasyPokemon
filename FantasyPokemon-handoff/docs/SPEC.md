# FantasyPokemon — Game Spec

An ESPN-style fantasy football league where every player is a Pokémon mapped to a real NFL starter. One human team plus 9 CPU teams, a snake draft, then weekly head-to-head matchups scored from **real NFL stats with a Pokémon layer on top**.

This spec captures decisions made during planning (Oct 28, 2026). **If anything here conflicts with what is already in the repo, the repo's existing structure and conventions win.** Adapt this spec to them; don't restructure working code to match it.

Stack: React + Vite, no backend, localStorage for persistence, with room to add a database later.

---

## 1. Data (already built, in `data/`)

### `data/pairs.json`

`meta` + `pairs[]`, 704 entries (Pokémon Gens 1–6, minus 17 low-stat Pokémon listed in `meta.unmatchedPokemon`).

```jsonc
{
  "id": "001", // zero-padded dex, stable key
  "dex": 1,
  "pokemon": "Bulbasaur",
  "gen": 1,
  "types": ["Grass", "Poison"],
  "baseStats": {
    "hp": 45,
    "atk": 49,
    "def": 49,
    "spa": 65,
    "spd": 65,
    "spe": 45,
  },
  "bst": 318,
  "fantasyPos": "K", // QB | RB | WR | TE | K | DEF
  "defGroup": null, // DL | LB | CB | S for DEF, else null
  "posRank": 18, // rank within fantasyPos (1 = best) at time of matching
  "nfl": {
    "name": "Dominic Zvada",
    "gsisId": "00-00xxxxx", // nflverse player ID — join weekly stats on this
    "team": "NYG",
    "depthSlot": "PK", // nflverse depth chart slot
    "maddenOvr": 75, // Madden NFL 27, Week 6 roster update
    "maddenPos": "K",
    "productionScore": 7.4, // per-game ranking score used for matching (not fantasy points)
  },
}
```

The pool is each NFL team's 22 starters from the 2026-10-28 depth chart: QB1, RB1–2, WR1–4, TE1–2, K, and 12 defenders (11 starters + nickel CB). 32 teams × 22 = 704.

### `data/dst_units.json`

32 D/ST units. Defensive Pokémon are not drafted individually. They make up their NFL team's D/ST, and **the D/ST is the draftable unit**.

```jsonc
{
  "team": "SF",
  "members": ["075", "..."],
  "dominantType": "Rock",
  "typeCounts": { "Rock": 4, "...": 0 },
}
```

`dominantType` = most common type among the unit's 12 Pokémon (ties broken alphabetically). It drives the type-matchup twist.

### `scripts/match_pairs.py`

Rebuilds the pairs from PokeAPI + nflverse CSVs (instructions in the file header). It reproduces `pairs.json` exactly except for Madden ratings, which were joined by hand from EA's ratings pages because EA has no public API. You only need this to re-pair after big depth-chart changes; normally leave pairs fixed for a season.

### Still to build

- **Weekly points table.** A refresh script that pulls nflverse `stats_player_week_2026.csv` (and team defense / schedule data for D/ST) and writes `data/weekly_points.json`: `{ week: { gsisId|teamDST: realPoints } }`.
- **Projections.** `projectedPPG` per pair for the draft board: per-game PPR, 65% 2026 + 35% 2025, shrunk for small samples (`points / (games + 2)`), the same method used for matching.

---

## 2. League rules

| Setting        | Value                                                                        |
| -------------- | ---------------------------------------------------------------------------- |
| Teams          | 10 (1 human, 9 CPU)                                                          |
| Lineup         | QB, RB, RB, WR, WR, TE, FLEX (RB/WR/TE), K, D/ST                             |
| Bench          | 6                                                                            |
| Roster size    | 15                                                                           |
| Draft          | Snake, 15 rounds, random draft order                                         |
| Regular season | Weeks 1–14, round-robin schedule (everyone plays everyone at least once)     |
| Playoffs       | Top 4 by record (tiebreak: points for). Semis week 15, final week 16         |
| Trades         | **None.** Out of scope by design                                             |
| Scoring        | ESPN standard PPR (offense), ESPN standard D/ST, then the Pokémon layer (§4) |

The league replays the 2026 NFL season from Week 1. Weeks unlock as `weekly_points.json` has data; future weeks show projections only.

---

## 3. CPU draft: best pick for the team, not best player

No personalities or quirks. Every CPU team uses the same logic.

**Step 1. Value over replacement (VOR).**
`VOR = projectedPPG − replacementPPG[pos]`

Replacement level is the projected PPG of the player at this rank within the position. It's roughly the best player still available after every team has filled its starters:

| QB   | RB   | WR   | TE   | K    | D/ST |
| ---- | ---- | ---- | ---- | ---- | ---- |
| 12th | 30th | 30th | 12th | 11th | 11th |

(RB/WR at 30 accounts for the FLEX.)

**Step 2. Roster need multiplier.**

| Situation                                             | Multiplier |
| ----------------------------------------------------- | ---------- |
| Fills an open starting slot (incl. FLEX for RB/WR/TE) | 1.0        |
| 1st bench RB or WR                                    | 0.6        |
| 2nd+ bench RB or WR                                   | 0.4        |
| Backup QB or TE                                       | 0.2        |
| 3rd QB/TE, any 2nd K or D/ST                          | 0          |
| K or D/ST before the final 2 rounds                   | 0          |

**Step 3. Snake awareness (scarcity).**
Count the picks until this team picks again (`picksUntilNext`). For each position, estimate who will still be there: the best available player after the next `picksUntilNext` players by VOR are removed. Add a scarcity bonus:
`scarcity = VOR(best now at pos) − VOR(expected best at pos at next pick)`

**Pick score** = `VOR × needMultiplier + 0.5 × scarcity`. Take the highest score. Use Madden OVR as the tiebreaker.

The human gets the same board sorted by plain VOR as the "recommended" ranking. Auto-pick (timer expiry) uses the CPU logic for the human's roster.

**Sanity checks:** no CPU team should end the draft without a starter at every lineup slot, and no team should have 2 K or 2 D/ST.

---

## 4. Weekly scoring: real points + Pokémon layer

```
finalPoints = realPoints × (1 + typeMod + evolutionBonus)
```

The layer is capped at ±10% total so real NFL production always dominates.

### 4.1 Type matchup (`typeMod`)

The matchup is **fantasy team vs fantasy team**, not the NFL schedule.

- **Offensive players:** use the player's types to attack the _fantasy opponent's starting D/ST_ `dominantType`. Use the best multiplier across the player's types (Gen 6 type chart, Fairy included).
- **D/ST:** its `dominantType` attacks the fantasy opponent's _starting QB_ (best multiplier vs either of the QB's types, treating the QB as defender).
- **K:** no type modifier.

| Effectiveness                      | typeMod |
| ---------------------------------- | ------- |
| Super effective (×2 or ×4)         | +0.05   |
| Neutral                            | 0       |
| Not very effective (×0.5 or ×0.25) | −0.05   |
| No effect (×0)                     | −0.08   |

Show it on the matchup card ("It's super effective!").

### 4.2 Evolution (`evolutionBonus`)

- **Trigger:** each time a Pokémon logs 3 qualifying weeks, it evolves one stage. Qualifying = ≥20 real points (K: ≥12, D/ST: ≥15). The counter resets after each evolution.
- **Effect:** +0.03 per stage gained this season, max 2 stages (+0.06). Permanent for the season.
- **Display only:** the pair keeps its NFL player. The card shows the evolved form's name/sprite ("Charmander → Charmeleon"). An evolved form that is also its own pair (e.g. Charmeleon ↔ Braelon Allen) is unaffected.
- **Fully evolved or single-stage Pokémon:** no form change, but they still earn the bonus ("powered up").
- Evolution chains come from PokeAPI `pokemon_species.csv` (`evolves_from_species_id`).

### 4.3 Shiny (cosmetic)

A single week of ≥30 real points (K/D/ST: ≥20) makes the Pokémon shiny for the rest of the season. No stat effect. Feature it in the news feed.

### 4.4 Fainted (injuries)

If the NFL player doesn't play (injured, inactive, bye), the Pokémon shows as **fainted** and scores 0, same as real fantasy. Lineup screens should warn about fainted or bye-week starters before lock.

### 4.5 Rounding / ties

Round final points to 0.1. A tied matchup counts as a tie (ESPN style). Ties count as half a win for standings.

---

## 5. Waivers (no trades)

- After each week resolves, all non-rostered pairs are free agents.
- **Priority:** resets weekly, inverse standings (worst record = #1). Each successful claim uses that team's priority for the week.
- **Human:** submits claims (add X / drop Y) before processing.
- **CPU claims only when it clearly helps:**
  1. A starter is fainted for the coming week and a free agent at that position projects above its bench option, or
  2. A free agent's projected PPG beats the team's weakest _starter_ at that position by ≥15%.

  It drops its lowest-VOR bench player at a non-starting position. Max 2 CPU claims per team per week, which prevents churn.

- **CPU lineups:** start the highest projected (non-fainted) players at each slot every week.

---

## 6. News feed

Auto-generated after each week from results. Templates, roughly in priority order:

- Matchup results with the week's biggest upset (lower-record team wins) and blowout
- Top scorer of the week league-wide ("Mewtwo threw for 3 TDs, 31.4 pts")
- Evolutions ("Charmander evolved into Charmeleon after a 4-FG day!")
- Shinies
- Faintings of notable starters
- Notable waiver pickups ("Team Rocket claimed Pikachu off waivers")
- Standings movement / playoff clinch & elimination (late season)

Keep it to about 5–8 items per week.

---

## 7. Screens (build order)

1. **League setup:** league name, human team name, start.
2. **Draft room:** board (sortable, position filters, VOR + Madden OVR + projection), human's roster panel, pick ticker, timer + auto-pick.
3. **My Team:** lineup slots, bench, start/sit, fainted/bye warnings.
4. **Matchup:** ESPN-style head-to-head card with projected vs final, per-player Pokémon modifiers ("super effective", evolution bonus).
5. **Standings:** W-L-T, PF, PA, playoff line.
6. **Free agents / waivers:** search, claim, priority shown.
7. **News feed.**

---

## 8. Out of scope (decided)

- Trades (human or CPU)
- CPU draft personalities/quirks
- Playable on-field football
- Backend / database (localStorage for now)

---

## 9. Suggested first task in Claude Code

1. Add `data/` and `scripts/` from this handoff to the repo.
2. Build the data layer: loaders for `pairs.json` / `dst_units.json`, a `projectedPPG` field, and the weekly-points refresh script.
3. Then build the draft engine (§3) as pure functions with unit tests (VOR, need multiplier, scarcity, full 10-team mock draft passes the sanity checks) before any UI.

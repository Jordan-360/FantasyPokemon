/**
 * Pokémon ↔ NFL player matching engine.
 *
 * Exports:
 *   SCORING_CONFIG   — all weights in one place for easy tuning
 *   buildScoringContext — precomputes normalization stats from the loaded data
 *   fitScore         — single-pair score in [0, 1]
 *   galeShapley      — stable matching algorithm, returns formId → playerId
 */

import type { Pokemon } from '../types/pokemon.js'
import type { NFLPlayer } from '../types/player.js'
import type { ScoringContext } from '../types/matching.js'

// ---------------------------------------------------------------------------
// Config — change weights here; all component scores are already in [0, 1]
// ---------------------------------------------------------------------------

export const SCORING_CONFIG = {
  // Top-level component weights. Must sum to 1.
  weights: {
    stat: 0.65, // base stats drive positional fit
    typeAffinity: 0.1, // small type bonus on top
    // Physical fit is 0: Pokémon sizes are fictional (Wailord = 14.5m,
    // Flabébé = 0.1m) so body-size comparison to human athletes is noise.
    physicalFit: 0.0,
    // Bumped to 0.25 now that talent is normalized within each position group
    // (best DL = 1.0, not ranked 800th globally because defense ≠ fantasy points).
    talentTier: 0.25,
  },

  // Per-position stat weights. Each set must sum to 1.0.
  // Stat keys match Pokemon interface fields.
  positionStats: {
    // QB: cerebral + mobile. Sp. Atk = arm talent, Sp. Def = reading the defense.
    QB: { spAttack: 0.35, spDefense: 0.35, speed: 0.3 },
    // RB: speed-first back, physical with durability.
    RB: { speed: 0.4, attack: 0.35, hp: 0.25 },
    // WR: pure speed, then separation quickness (Sp. Atk proxy).
    WR: { speed: 0.6, spAttack: 0.4 },
    // TE: blocking (attack) first, then athleticism (speed) and anchor (defense).
    TE: { attack: 0.4, speed: 0.3, defense: 0.3 },
    // K: leg strength (attack) + accuracy (Sp. Atk) + composure (Sp. Def).
    // Deliberately spread so pure Sp. Atk specialists don't dominate this slot.
    K: { spAttack: 0.5, attack: 0.3, spDefense: 0.2 },
    // DL: holding the line (defense) is paramount; attack = pass rush; hp = bulk.
    DL: { defense: 0.4, attack: 0.3, hp: 0.3 },
    // LB: motor (attack), pursuit speed, gap control (defense).
    LB: { attack: 0.4, speed: 0.35, defense: 0.25 },
    // CB: elite speed required, then ball-hawk instinct (Sp. Def).
    CB: { speed: 0.65, spDefense: 0.35 },
    // S: equal parts closing speed and deep-zone instinct (Sp. Def).
    S: { speed: 0.5, spDefense: 0.5 },
  } as Record<string, Record<string, number>>,

  // Type affinities: having any matching type gives a bonus.
  typeAffinities: {
    QB: ['psychic'],
    RB: ['fighting', 'ground'],
    WR: ['flying', 'electric'],
    TE: ['fighting', 'water'],
    K: ['psychic', 'fairy'],
    DL: ['rock', 'steel', 'fighting'],
    LB: ['fighting', 'ground', 'rock'],
    CB: ['flying', 'electric'],
    S: ['psychic', 'dark'],
  } as Record<string, string[]>,
}

export type ScoringConfig = typeof SCORING_CONFIG

// ---------------------------------------------------------------------------
// Context builder — call once after loading JSON; pass result into fitScore
// ---------------------------------------------------------------------------

export function buildScoringContext(
  players: NFLPlayer[],
  pokemon: Pokemon[],
): ScoringContext {
  // --- Per-position height/weight stats (players only, skip nulls) ---
  const positionStats: ScoringContext['positionStats'] = {}

  const positions = [...new Set(players.map((p) => p.position))]
  for (const pos of positions) {
    const group = players.filter((p) => p.position === pos)

    const heights = group
      .map((p) => p.height)
      .filter((h): h is number => h !== null)
    const weights = group
      .map((p) => p.weight)
      .filter((w): w is number => w !== null)

    positionStats[pos] = {
      meanHeight: mean(heights),
      stdHeight: std(heights),
      meanWeight: mean(weights),
      stdWeight: std(weights),
    }
  }

  // --- Global BST range across all Pokémon ---
  const bsts = pokemon.map(bst)
  const bstRange = { min: Math.min(...bsts), max: Math.max(...bsts) }

  // --- Per-position talent scores ---
  // Players are ranked within their own position group so that the best DL
  // is treated as equally elite to the best QB. Using a global fantasy rank
  // breaks this: defensive players score low in fantasy even when dominant
  // in real football, causing weak Pokémon to attract mid-ranked WRs over
  // the top DL/LB players who have higher (worse) global ranks.
  const playerTalent: Record<string, number> = {}
  const positionGroups = new Map<string, NFLPlayer[]>()
  for (const p of players) {
    if (!positionGroups.has(p.position)) positionGroups.set(p.position, [])
    positionGroups.get(p.position)!.push(p)
  }
  for (const group of positionGroups.values()) {
    group.sort((a, b) => a.searchRank - b.searchRank) // lower rank = better
    group.forEach((p, idx) => {
      // idx 0 → talent 1.0 (best in position), idx N-1 → talent 0.0 (worst)
      playerTalent[p.playerId] =
        group.length > 1 ? 1 - idx / (group.length - 1) : 1.0
    })
  }

  return { positionStats, bstRange, playerTalent }
}

// ---------------------------------------------------------------------------
// fitScore — combines four components into a single [0, 1] score
// ---------------------------------------------------------------------------

export function fitScore(
  mon: Pokemon,
  player: NFLPlayer,
  ctx: ScoringContext,
  config: ScoringConfig,
): number {
  const pos = player.position
  const { weights } = config

  // 1. STAT SCORE
  // Weight the Pokémon's base stats according to what the position demands.
  // Divide by 255 (max possible stat) to normalize to [0, 1].
  const statWeights = config.positionStats[pos] ?? {}
  let rawStat = 0
  for (const [statKey, w] of Object.entries(statWeights)) {
    rawStat += (mon[statKey as keyof Pokemon] as number) * w
  }
  const statScore = rawStat / 255

  // 2. TYPE AFFINITY SCORE
  // If the Pokémon has any type that fits the position, give a full bonus.
  // This stays small (weight 0.10) so it tips ties rather than dominating.
  const affinityTypes = config.typeAffinities[pos] ?? []
  const typeAffinityScore = mon.types.some((t) => affinityTypes.includes(t))
    ? 1.0
    : 0.0

  // 3. PHYSICAL FIT SCORE
  // Compare the Pokémon's converted dimensions to the average body type at
  // this position using a Gaussian kernel. Score = 1 when perfectly centred,
  // falls off with distance in standard-deviation units.
  // Units: PokeAPI gives height in decimetres and weight in hectograms.
  const NEUTRAL_PHYSICAL = 0.5 // used when either side is missing data
  let physicalFitScore = NEUTRAL_PHYSICAL

  const posStat = ctx.positionStats[pos]
  if (posStat && posStat.stdHeight > 0 && posStat.stdWeight > 0) {
    const pokemonHeightIn = mon.height * 3.937 // dm → inches
    const pokemonWeightLb = mon.weight * 0.2205 // hg → lbs

    const zH = (pokemonHeightIn - posStat.meanHeight) / posStat.stdHeight
    const zW = (pokemonWeightLb - posStat.meanWeight) / posStat.stdWeight

    // Euclidean distance in z-score space, then Gaussian decay
    const distSq = zH * zH + zW * zW
    physicalFitScore = Math.exp(-distSq / 2)
  }

  // 4. TALENT TIER SCORE
  // Uses a product (bstNorm × playerTalent) rather than a distance formula.
  //
  // Why product instead of |bst - talent|:
  // The distance formula creates diagonal preferences — a mid-BST Pokémon
  // (0.64) prefers the mid-ranked player (0.64) over Ja'Marr Chase (1.0)
  // because |0.64 - 0.64| < |0.64 - 1.0|. Elite players then only attract
  // the tiny handful of near-720-BST Pokémon, leaving Chase with whatever's
  // left after those go to other positions.
  //
  // With the product, every Pokémon prefers elite players — Jolteon scores
  // higher against Chase (0.64 × 1.0 = 0.64) than the 46th WR (0.64 × 0.64
  // = 0.41). Competition for top slots is fierce; the best stat-fit Pokémon
  // wins each one. The weakest Pokémon (BST ≈ 0) get zero talent contribution
  // everywhere and get displaced until the ~19 weakest go unmatched.
  const normalizedBST = normalize(bst(mon), ctx.bstRange.min, ctx.bstRange.max)
  const playerTal = ctx.playerTalent[player.playerId] ?? 0.5

  const talentTierScore = normalizedBST * playerTal

  return (
    weights.stat * statScore +
    weights.typeAffinity * typeAffinityScore +
    weights.physicalFit * physicalFitScore +
    weights.talentTier * talentTierScore
  )
}

// ---------------------------------------------------------------------------
// Gale-Shapley stable matching (Pokémon propose, players hold best offer)
// ---------------------------------------------------------------------------

/**
 * Returns a Map<formId, playerId> — every matched Pokémon's partner.
 * Pokémon left unmatched (exhausted all proposals) are absent from the map.
 * Players left without a Pokémon are simply not held by anyone.
 *
 * Complexity: O(P × N) pre-computation + O(P × N) proposals in worst case,
 * where P = number of Pokémon and N = number of players.
 */
export function galeShapley(
  pokemon: Pokemon[],
  players: NFLPlayer[],
  ctx: ScoringContext,
  config: ScoringConfig,
): Map<string, string> {
  // Step 1: precompute fitScore for every (pokemon, player) pair.
  // This lets the proposal loop do O(1) score lookups instead of recomputing.
  console.log(
    `Precomputing ${pokemon.length} × ${players.length} = ${pokemon.length * players.length} scores…`,
  )
  const scores = new Map<string, Map<string, number>>()
  for (const mon of pokemon) {
    const playerScores = new Map<string, number>()
    for (const player of players) {
      playerScores.set(player.playerId, fitScore(mon, player, ctx, config))
    }
    scores.set(mon.formId, playerScores)
  }

  // Step 2: build each Pokémon's preference list (players sorted by score desc).
  const prefList = new Map<string, string[]>()
  for (const mon of pokemon) {
    const playerScores = scores.get(mon.formId)!
    const sorted = [...players]
      .sort(
        (a, b) => playerScores.get(b.playerId)! - playerScores.get(a.playerId)!,
      )
      .map((p) => p.playerId)
    prefList.set(mon.formId, sorted)
  }

  // Step 3: run Gale-Shapley.
  //
  // freeQueue: Pokémon waiting to make their next proposal.
  // We use a head pointer instead of shift() to avoid O(n) queue operations.
  const freeQueue: Pokemon[] = [...pokemon]
  let head = 0

  // How far each Pokémon has progressed through its preference list.
  const nextProposal = new Map<string, number>()

  // Which Pokémon a player is currently holding (and at what score).
  const held = new Map<string, { formId: string; score: number }>()

  // Fast Pokémon lookup by formId for when a displaced Pokémon re-enters.
  const monByFormId = new Map<string, Pokemon>(
    pokemon.map((m) => [m.formId, m]),
  )

  while (head < freeQueue.length) {
    const mon = freeQueue[head++]
    const pref = prefList.get(mon.formId)!
    const idx = nextProposal.get(mon.formId) ?? 0

    // Pokémon has exhausted every player — it stays unmatched.
    if (idx >= pref.length) continue

    // Propose to the next player on the preference list.
    nextProposal.set(mon.formId, idx + 1)
    const playerId = pref[idx]
    const score = scores.get(mon.formId)!.get(playerId)!

    const current = held.get(playerId)
    if (!current) {
      // Player is free — tentative accept.
      held.set(playerId, { formId: mon.formId, score })
    } else if (score > current.score) {
      // New proposer is better — player switches, old holder re-enters the pool.
      const displaced = monByFormId.get(current.formId)!
      freeQueue.push(displaced)
      held.set(playerId, { formId: mon.formId, score })
    } else {
      // Current holder is preferred — reject new proposer.
      // nextProposal was already incremented, so next attempt goes to the next player.
      freeQueue.push(mon)
    }
  }

  // Build the final formId → playerId map from the held entries.
  const result = new Map<string, string>()
  for (const [playerId, { formId }] of held) {
    result.set(formId, playerId)
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bst(mon: Pokemon): number {
  return (
    mon.hp + mon.attack + mon.defense + mon.spAttack + mon.spDefense + mon.speed
  )
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((s, v) => s + v, 0) / values.length
}

function std(values: number[]): number {
  if (values.length < 2) return 1 // fallback: avoid division by zero
  const m = mean(values)
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length
  return Math.sqrt(variance) || 1
}

function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0.5 // degenerate range: return midpoint
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

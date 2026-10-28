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
    stat: 0.6, // dominant: base stats drive the match
    typeAffinity: 0.1, // small type bonus on top
    physicalFit: 0.15, // body-size match to the position's typical profile
    talentTier: 0.15, // legendary Pokémon → elite players; weak Pokémon → backups
  },

  // Per-position stat weights. Each set must sum to 1.0.
  // Stat keys match Pokemon interface fields.
  positionStats: {
    // QB: cerebral + mobile. Sp. Atk = arm IQ, Sp. Def = reading the defense.
    QB: { spAttack: 0.35, spDefense: 0.35, speed: 0.3 },
    // RB: physical, tough, fast.
    RB: { attack: 0.4, hp: 0.3, speed: 0.3 },
    // WR: speed-first, then route quickness (Sp. Atk proxy).
    WR: { speed: 0.55, spAttack: 0.45 },
    // TE: balanced blocker/receiver.
    TE: { attack: 0.35, defense: 0.35, speed: 0.3 },
    // K: pure precision — Sp. Atk models accuracy.
    K: { spAttack: 1.0 },
    // DL: big, strong, durable.
    DL: { hp: 0.35, defense: 0.35, attack: 0.3 },
    // LB: can hit (attack), hold ground (defense), and chase (speed).
    LB: { attack: 0.35, defense: 0.35, speed: 0.3 },
    // CB: cover corner — speed and Sp. Def (pass coverage intuition).
    CB: { speed: 0.6, spDefense: 0.4 },
    // S: safety — slightly less speed-reliant than CB, more instinct (Sp. Def).
    S: { speed: 0.55, spDefense: 0.45 },
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

  // --- Player rank range, excluding the sentinel value for missing ranks ---
  const realRanks = players.map((p) => p.searchRank).filter((r) => r < 99999)
  const playerRankRange = {
    min: Math.min(...realRanks),
    max: Math.max(...realRanks),
  }

  return { positionStats, bstRange, playerRankRange }
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
  // High-BST Pokémon should land with high-ranked (low searchRank) players.
  // Normalize both to [0, 1] and penalize the gap between their talent tiers.
  // normalizedBST: 0 = weakest, 1 = strongest
  // playerTalent:  0 = worst rank, 1 = best rank (inverted searchRank)
  const { bstRange, playerRankRange } = ctx
  const normalizedBST = normalize(bst(mon), bstRange.min, bstRange.max)

  const clampedRank = Math.min(player.searchRank, playerRankRange.max)
  const normalizedRank = normalize(
    clampedRank,
    playerRankRange.min,
    playerRankRange.max,
  )
  const playerTalent = 1 - normalizedRank // invert: low rank = high talent

  // 1.0 when tiers match exactly; falls to 0.0 when maximally mismatched
  const talentTierScore = 1 - Math.abs(normalizedBST - playerTalent)

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

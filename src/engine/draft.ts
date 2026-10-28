// Snake draft and CPU pick logic (docs/SPEC.md §3). Pure functions: every
// function takes the data it needs and returns new values without mutating.

import type { DstUnit } from '../types/dst'
import type { Pair } from '../types/pair'
import type {
  Draftable,
  DraftPick,
  DraftPos,
  DraftSettings,
  DraftState,
} from '../types/draft'
import { shuffle, type Rng } from './random'

export const DEFAULT_SETTINGS: DraftSettings = { teams: 10, rounds: 15 }

export const DRAFT_POSITIONS: readonly DraftPos[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DST',
]

// Dedicated starting slots per position; FLEX is counted separately
export const STARTERS: Record<DraftPos, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  DST: 1,
}
export const FLEX_POSITIONS: readonly DraftPos[] = ['RB', 'WR', 'TE']

// Replacement level = projected PPG of the Nth best at the position
export const REPLACEMENT_RANK: Record<DraftPos, number> = {
  QB: 12,
  RB: 30,
  WR: 30,
  TE: 12,
  K: 11,
  DST: 11,
}

export const SCARCITY_WEIGHT = 0.5
// K and D/ST are only drafted in the last this-many rounds
export const LATE_ROUNDS_FOR_K_DST = 2

export type ReplacementLevels = Record<DraftPos, number>

// Everything about the player pool that stays fixed for a draft
export interface DraftBoard {
  players: Draftable[] // sorted by VOR, best first
  byId: Map<string, Draftable>
  replacement: ReplacementLevels
}

// --- Pool -----------------------------------------------------------------

export function dstId(team: string): string {
  return `DST-${team}`
}

export function buildDraftPool(
  pairs: Pair[],
  dstUnits: DstUnit[],
): Draftable[] {
  const offense: Draftable[] = pairs
    .filter((p) => p.fantasyPos !== 'DEF')
    .map((p) => ({
      id: p.id,
      pos: p.fantasyPos as DraftPos,
      name: p.pokemon,
      nflName: p.nfl.name,
      team: p.nfl.team,
      projectedPPG: p.projectedPPG,
      maddenOvr: p.nfl.maddenOvr,
    }))
  const dst: Draftable[] = dstUnits.map((u) => ({
    id: dstId(u.team),
    pos: 'DST',
    name: `${u.team} D/ST`,
    nflName: u.team,
    team: u.team,
    projectedPPG: u.projectedPPG,
    maddenOvr: u.maddenOvr,
  }))
  return [...offense, ...dst]
}

// --- Step 1: value over replacement --------------------------------------

export function replacementLevels(
  pool: readonly Draftable[],
): ReplacementLevels {
  const levels = {} as ReplacementLevels
  for (const pos of DRAFT_POSITIONS) {
    const ppg = pool
      .filter((p) => p.pos === pos)
      .map((p) => p.projectedPPG)
      .sort((a, b) => b - a)
    // A thin position falls back to its worst player
    levels[pos] = ppg[Math.min(REPLACEMENT_RANK[pos], ppg.length) - 1] ?? 0
  }
  return levels
}

export function vor(player: Draftable, replacement: ReplacementLevels): number {
  return player.projectedPPG - replacement[player.pos]
}

// Higher madden wins a tie, then id so results never depend on input order
function compareTiebreak(a: Draftable, b: Draftable): number {
  return b.maddenOvr - a.maddenOvr || a.id.localeCompare(b.id)
}

export function createDraftBoard(pool: readonly Draftable[]): DraftBoard {
  const replacement = replacementLevels(pool)
  const players = [...pool].sort(
    (a, b) =>
      vor(b, replacement) - vor(a, replacement) || compareTiebreak(a, b),
  )
  return { players, byId: new Map(players.map((p) => [p.id, p])), replacement }
}

// --- Draft state ----------------------------------------------------------

// draftOrder is the round-1 order; even rounds reverse it
export function snakeOrder(
  draftOrder: readonly number[],
  rounds: number,
): number[] {
  const order: number[] = []
  for (let r = 0; r < rounds; r++) {
    order.push(...(r % 2 === 0 ? draftOrder : [...draftOrder].reverse()))
  }
  return order
}

export function randomDraftOrder(teams: number, rng: Rng): number[] {
  return shuffle(
    Array.from({ length: teams }, (_, i) => i),
    rng,
  )
}

export function createDraft(
  draftOrder: readonly number[],
  settings: DraftSettings = DEFAULT_SETTINGS,
): DraftState {
  if (draftOrder.length !== settings.teams) {
    throw new Error(
      `draft order has ${draftOrder.length} teams, expected ${settings.teams}`,
    )
  }
  return { settings, order: snakeOrder(draftOrder, settings.rounds), picks: [] }
}

export function isDraftComplete(state: DraftState): boolean {
  return state.picks.length >= state.order.length
}

export interface OnTheClock {
  overall: number
  round: number
  teamIndex: number
}

export function onTheClock(state: DraftState): OnTheClock | null {
  if (isDraftComplete(state)) return null
  const overall = state.picks.length
  return {
    overall,
    round: Math.floor(overall / state.settings.teams) + 1,
    teamIndex: state.order[overall],
  }
}

export function draftedIds(state: DraftState): Set<string> {
  return new Set(state.picks.map((p) => p.playerId))
}

export function availablePlayers(
  board: DraftBoard,
  state: DraftState,
): Draftable[] {
  const taken = draftedIds(state)
  return board.players.filter((p) => !taken.has(p.id))
}

// A team's players in the order they were drafted
export function teamRoster(
  board: DraftBoard,
  state: DraftState,
  teamIndex: number,
): Draftable[] {
  return state.picks
    .filter((p) => p.teamIndex === teamIndex)
    .map((p) => board.byId.get(p.playerId)!)
}

export function makePick(state: DraftState, playerId: string): DraftState {
  const clock = onTheClock(state)
  if (!clock) throw new Error('draft is complete')
  if (draftedIds(state).has(playerId)) {
    throw new Error(`${playerId} has already been drafted`)
  }
  const pick: DraftPick = {
    overall: clock.overall,
    round: clock.round,
    teamIndex: clock.teamIndex,
    playerId,
  }
  return { ...state, picks: [...state.picks, pick] }
}

// --- Step 2: roster need --------------------------------------------------

export function positionCounts(
  roster: readonly Draftable[],
): Record<DraftPos, number> {
  const counts: Record<DraftPos, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DST: 0,
  }
  for (const p of roster) counts[p.pos]++
  return counts
}

// The FLEX goes to the first RB/WR/TE drafted beyond its position's starters
function flexHolder(roster: readonly Draftable[]): DraftPos | null {
  const seen: Record<DraftPos, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DST: 0,
  }
  for (const p of roster) {
    seen[p.pos]++
    if (FLEX_POSITIONS.includes(p.pos) && seen[p.pos] > STARTERS[p.pos])
      return p.pos
  }
  return null
}

// Starting slots (FLEX included) still empty
export function openStartingSlots(roster: readonly Draftable[]): number {
  const counts = positionCounts(roster)
  const dedicated = DRAFT_POSITIONS.reduce(
    (sum, pos) => sum + Math.max(0, STARTERS[pos] - counts[pos]),
    0,
  )
  return dedicated + (flexHolder(roster) ? 0 : 1)
}

export function fillsStartingSlot(
  roster: readonly Draftable[],
  pos: DraftPos,
): boolean {
  const counts = positionCounts(roster)
  if (counts[pos] < STARTERS[pos]) return true
  return FLEX_POSITIONS.includes(pos) && flexHolder(roster) === null
}

// SPEC §3 step 2. `round` is 1-based.
export function needMultiplier(
  roster: readonly Draftable[],
  pos: DraftPos,
  round: number,
  totalRounds: number,
): number {
  const count = positionCounts(roster)[pos]

  if (pos === 'K' || pos === 'DST') {
    if (round <= totalRounds - LATE_ROUNDS_FOR_K_DST) return 0
    return count === 0 ? 1 : 0
  }
  if (fillsStartingSlot(roster, pos)) return 1
  if (pos === 'QB' || pos === 'TE') return count === 1 ? 0.2 : 0

  // RB / WR bench depth: extras at this position not already in the FLEX
  const benchAtPos =
    count - STARTERS[pos] - (flexHolder(roster) === pos ? 1 : 0)
  return benchAtPos === 0 ? 0.6 : 0.4
}

// --- Step 3: snake awareness ---------------------------------------------

// Picks by other teams before this team is up again; null if it never is
export function picksUntilNext(
  state: DraftState,
  overall: number,
): number | null {
  const team = state.order[overall]
  const next = state.order.indexOf(team, overall + 1)
  return next === -1 ? null : next - overall - 1
}

// VOR lost at each position by waiting until the next pick. Assumes the
// other teams take the `picksBetween` best players by plain VOR.
// `available` must be sorted by VOR, best first (as board.players is).
export function scarcityByPosition(
  available: readonly Draftable[],
  replacement: ReplacementLevels,
  picksBetween: number | null,
): Record<DraftPos, number> {
  const result: Record<DraftPos, number> = {
    QB: 0,
    RB: 0,
    WR: 0,
    TE: 0,
    K: 0,
    DST: 0,
  }
  if (picksBetween === null) return result

  for (const pos of DRAFT_POSITIONS) {
    const bestNow = available.find((p) => p.pos === pos)
    if (!bestNow) continue
    const expected = available.slice(picksBetween).find((p) => p.pos === pos)
    const nowVor = vor(bestNow, replacement)
    // Position wiped out: everything above replacement would be lost
    result[pos] = expected
      ? nowVor - vor(expected, replacement)
      : Math.max(0, nowVor)
  }
  return result
}

// --- Pick selection -------------------------------------------------------

export interface ScoredCandidate {
  player: Draftable
  vor: number
  need: number
  scarcity: number
  score: number
}

// Every available player scored for the team on the clock, best first.
// Players this team shouldn't take (need 0, or a non-starter when every
// remaining pick must fill a starting slot) are left out.
export function scoreCandidates(
  board: DraftBoard,
  state: DraftState,
): ScoredCandidate[] {
  const clock = onTheClock(state)
  if (!clock) return []

  const roster = teamRoster(board, state, clock.teamIndex)
  const available = availablePlayers(board, state)
  const scarcity = scarcityByPosition(
    available,
    board.replacement,
    picksUntilNext(state, clock.overall),
  )
  const picksLeft = state.settings.rounds - roster.length
  const mustFillStarters = picksLeft <= openStartingSlots(roster)

  // Only the best available at each position can win, so score just those
  const bestAtPos = new Map<DraftPos, Draftable>()
  for (const p of available) if (!bestAtPos.has(p.pos)) bestAtPos.set(p.pos, p)

  let candidates = [...bestAtPos.values()].map((player) => ({
    player,
    need: needMultiplier(
      roster,
      player.pos,
      clock.round,
      state.settings.rounds,
    ),
  }))
  if (mustFillStarters) {
    candidates = candidates.filter((c) =>
      fillsStartingSlot(roster, c.player.pos),
    )
    // K/D/ST still wait for the last rounds unless nothing else fills a slot
    if (candidates.every((c) => c.need === 0)) {
      candidates = candidates.map((c) => ({ ...c, need: 1 }))
    }
  }

  const scored: ScoredCandidate[] = []
  for (const { player, need } of candidates) {
    if (need === 0) continue
    const v = vor(player, board.replacement)
    scored.push({
      player,
      vor: v,
      need,
      scarcity: scarcity[player.pos],
      score: v * need + SCARCITY_WEIGHT * scarcity[player.pos],
    })
  }
  return scored.sort(
    (a, b) => b.score - a.score || compareTiebreak(a.player, b.player),
  )
}

// The CPU's pick for whoever is on the clock (also the human's auto-pick)
export function chooseCpuPick(board: DraftBoard, state: DraftState): Draftable {
  const best = scoreCandidates(board, state)[0]?.player
  // Fallback if every position was filtered out: best available by VOR
  const pick = best ?? availablePlayers(board, state)[0]
  if (!pick) throw new Error('no players left to draft')
  return pick
}

export function autoPick(board: DraftBoard, state: DraftState): DraftState {
  return makePick(state, chooseCpuPick(board, state).id)
}

// Run CPU picks until the given team is on the clock or the draft ends.
// Pass humanTeam = null to draft every team automatically (mock draft).
export function runCpuPicks(
  board: DraftBoard,
  state: DraftState,
  humanTeam: number | null,
): DraftState {
  let current = state
  let clock = onTheClock(current)
  while (clock && clock.teamIndex !== humanTeam) {
    current = autoPick(board, current)
    clock = onTheClock(current)
  }
  return current
}

// The human's "recommended" ranking: available players by plain VOR
export function recommendedBoard(
  board: DraftBoard,
  state: DraftState,
): Draftable[] {
  return availablePlayers(board, state)
}

// --- Sanity checks --------------------------------------------------------

// Problems with a finished roster; empty means it can field a full lineup
export function rosterProblems(roster: readonly Draftable[]): string[] {
  const counts = positionCounts(roster)
  const problems: string[] = []
  for (const pos of DRAFT_POSITIONS) {
    if (counts[pos] < STARTERS[pos]) problems.push(`no starter at ${pos}`)
  }
  if (!flexHolder(roster)) problems.push('no FLEX starter')
  if (counts.K > 1) problems.push(`${counts.K} kickers`)
  if (counts.DST > 1) problems.push(`${counts.DST} D/ST units`)
  return problems
}

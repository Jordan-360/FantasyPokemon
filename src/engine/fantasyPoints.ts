// Real-NFL fantasy scoring (before the Pokémon layer) and per-game projections.
// Offense uses nflverse's own `fantasy_points_ppr`, which already matches ESPN PPR,
// so only kickers and D/ST need formulas here.

export interface KickingLine {
  fgMade0to39: number
  fgMade40to49: number
  fgMade50plus: number
  fgMissed: number
  patMade: number
}

// ESPN standard kicker scoring
export const KICKER_SCORING = {
  fg0to39: 3,
  fg40to49: 4,
  fg50plus: 5,
  fgMissed: -1,
  patMade: 1,
}

export function kickerPoints(k: KickingLine): number {
  const s = KICKER_SCORING
  return (
    k.fgMade0to39 * s.fg0to39 +
    k.fgMade40to49 * s.fg40to49 +
    k.fgMade50plus * s.fg50plus +
    k.fgMissed * s.fgMissed +
    k.patMade * s.patMade
  )
}

export interface DefenseLine {
  sacks: number
  interceptions: number
  fumblesRecovered: number
  touchdowns: number // defensive + return TDs
  safeties: number
  blockedKicks: number
  pointsAllowed: number
  yardsAllowed: number // net: passing - sack yards + rushing
}

// ESPN standard D/ST scoring. Tiers are [upper bound inclusive, points].
export const DST_SCORING = {
  sack: 1,
  interception: 2,
  fumbleRecovered: 2,
  touchdown: 6,
  safety: 2,
  blockedKick: 2,
  pointsAllowedTiers: [
    [0, 5],
    [6, 4],
    [13, 3],
    [17, 1],
    [27, 0],
    [34, -1],
    [45, -3],
    [Infinity, -5],
  ],
  yardsAllowedTiers: [
    [99, 5],
    [199, 3],
    [299, 2],
    [349, 0],
    [399, -1],
    [449, -3],
    [499, -5],
    [549, -6],
    [Infinity, -7],
  ],
} as const

function tierPoints(
  value: number,
  tiers: readonly (readonly [number, number])[],
): number {
  const tier = tiers.find(([max]) => value <= max)
  return tier ? tier[1] : 0
}

export function dstPoints(d: DefenseLine): number {
  const s = DST_SCORING
  return (
    d.sacks * s.sack +
    d.interceptions * s.interception +
    d.fumblesRecovered * s.fumbleRecovered +
    d.touchdowns * s.touchdown +
    d.safeties * s.safety +
    d.blockedKicks * s.blockedKick +
    tierPoints(d.pointsAllowed, s.pointsAllowedTiers) +
    tierPoints(d.yardsAllowed, s.yardsAllowedTiers)
  )
}

export interface SeasonTotals {
  points: number
  games: number
}

export const PROJECTION_WEIGHTS = { current: 0.65, prior: 0.35 }
// Added to games played so a couple of big weeks can't dominate a projection
export const SHRINK_GAMES = 2

// Per-game projection: 65% current season + 35% prior, each shrunk as
// points / (games + 2). With no prior-season games, the current season stands
// alone. Mirrors score() in scripts/match_pairs.py.
export function projectPPG(
  current: SeasonTotals | undefined,
  prior: SeasonTotals | undefined,
): number {
  const cur = current ? current.points / (current.games + SHRINK_GAMES) : 0
  if (!prior || prior.games === 0) return cur
  const pri = prior.points / (prior.games + SHRINK_GAMES)
  return PROJECTION_WEIGHTS.current * cur + PROJECTION_WEIGHTS.prior * pri
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

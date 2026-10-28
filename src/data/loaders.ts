// Typed access to the generated JSON in this folder. The build* functions are
// pure (data in, data out) so tests can feed them fixtures; the load* functions
// wire them to the real files and cache the result.

import pairsJson from './pairs.json'
import dstUnitsJson from './dst_units.json'
import projectionsJson from './projections.json'
import weeklyPointsJson from './weekly_points.json'
import type { FantasyPos, Pair, RawPair } from '../types/pair'
import type { DstUnit, RawDstUnit } from '../types/dst'
import type { ProjectionsFile, WeeklyPointsFile } from '../types/points'

const FANTASY_POSITIONS: readonly FantasyPos[] = [
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF',
]

// Fail fast if a regenerated file drifts from the shape the app expects
function assertPairs(pairs: RawPair[]): void {
  const ids = new Set<string>()
  for (const p of pairs) {
    if (ids.has(p.id)) throw new Error(`pairs.json: duplicate id ${p.id}`)
    ids.add(p.id)
    if (!FANTASY_POSITIONS.includes(p.fantasyPos)) {
      throw new Error(`pairs.json: ${p.id} has bad fantasyPos ${p.fantasyPos}`)
    }
    if (!p.nfl?.gsisId) throw new Error(`pairs.json: ${p.id} has no gsisId`)
  }
}

// Defensive pairs score through their D/ST, so their projectedPPG is 0
export function buildPairs(
  rawPairs: RawPair[],
  projections: ProjectionsFile,
): Pair[] {
  assertPairs(rawPairs)
  return rawPairs.map((p) => ({
    ...p,
    projectedPPG:
      p.fantasyPos === 'DEF' ? 0 : (projections.players[p.nfl.gsisId] ?? 0),
  }))
}

export function buildDstUnits(
  rawUnits: RawDstUnit[],
  pairs: Pair[],
  projections: ProjectionsFile,
): DstUnit[] {
  const byId = new Map(pairs.map((p) => [p.id, p]))
  return rawUnits.map((u) => {
    const members = u.members.map((id) => {
      const pair = byId.get(id)
      if (!pair)
        throw new Error(`dst_units.json: ${u.team} member ${id} not in pairs`)
      return pair
    })
    const avgOvr =
      members.reduce((sum, p) => sum + p.nfl.maddenOvr, 0) / members.length
    return {
      ...u,
      projectedPPG: projections.dst[u.team] ?? 0,
      maddenOvr: Math.round(avgOvr * 10) / 10,
    }
  })
}

// JSON imports widen string unions (e.g. 'QB' becomes string), so the
// raw files are cast to their declared shapes once, here.
const rawPairs = pairsJson.pairs as RawPair[]
const rawDstUnits = dstUnitsJson as RawDstUnit[]
const projections = projectionsJson as ProjectionsFile
const weeklyPoints = weeklyPointsJson as WeeklyPointsFile

let pairsCache: Pair[] | undefined
let dstCache: DstUnit[] | undefined

export function loadPairs(): Pair[] {
  pairsCache ??= buildPairs(rawPairs, projections)
  return pairsCache
}

export function loadDstUnits(): DstUnit[] {
  dstCache ??= buildDstUnits(rawDstUnits, loadPairs(), projections)
  return dstCache
}

export function loadWeeklyPoints(): WeeklyPointsFile {
  return weeklyPoints
}

export function loadProjections(): ProjectionsFile {
  return projections
}

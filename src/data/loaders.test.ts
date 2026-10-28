import { describe, expect, it } from 'vitest'
import type { ProjectionsFile } from '../types/points'
import type { RawPair } from '../types/pair'
import {
  buildDstUnits,
  buildPairs,
  loadDstUnits,
  loadPairs,
  loadWeeklyPoints,
} from './loaders'

const projections: ProjectionsFile = {
  meta: { generatedAt: '', season: 2026, source: '', method: '' },
  players: { 'qb-1': 18.5 },
  dst: { TST: 7.2 },
}

function rawPair(
  id: string,
  fantasyPos: RawPair['fantasyPos'],
  gsisId: string,
  ovr = 80,
): RawPair {
  return {
    id,
    dex: Number(id),
    pokemon: `Mon ${id}`,
    gen: 1,
    types: ['Normal'],
    baseStats: { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 },
    bst: 6,
    fantasyPos,
    defGroup: fantasyPos === 'DEF' ? 'LB' : null,
    posRank: 1,
    nfl: {
      name: id,
      gsisId,
      team: 'TST',
      depthSlot: '',
      maddenOvr: ovr,
      maddenPos: '',
      productionScore: 0,
    },
  }
}

describe('buildPairs', () => {
  it('joins projectedPPG by gsisId, defaulting to 0', () => {
    const pairs = buildPairs(
      [rawPair('001', 'QB', 'qb-1'), rawPair('002', 'RB', 'rb-unknown')],
      projections,
    )
    expect(pairs.map((p) => p.projectedPPG)).toEqual([18.5, 0])
  })

  it('rejects duplicate ids', () => {
    expect(() =>
      buildPairs(
        [rawPair('001', 'QB', 'a'), rawPair('001', 'RB', 'b')],
        projections,
      ),
    ).toThrow(/duplicate id/)
  })
})

describe('buildDstUnits', () => {
  it('joins the team projection and averages member Madden OVR', () => {
    const pairs = buildPairs(
      [rawPair('010', 'DEF', 'd1', 80), rawPair('011', 'DEF', 'd2', 85)],
      projections,
    )
    const [unit] = buildDstUnits(
      [
        {
          team: 'TST',
          members: ['010', '011'],
          dominantType: 'Rock',
          typeCounts: {},
        },
      ],
      pairs,
      projections,
    )
    expect(unit.projectedPPG).toBe(7.2)
    expect(unit.maddenOvr).toBe(82.5)
  })

  it('throws on a member that is not a pair', () => {
    expect(() =>
      buildDstUnits(
        [
          {
            team: 'TST',
            members: ['999'],
            dominantType: 'Rock',
            typeCounts: {},
          },
        ],
        [],
        projections,
      ),
    ).toThrow(/not in pairs/)
  })
})

describe('real data files', () => {
  const pairs = loadPairs()
  const units = loadDstUnits()

  it('has 704 pairs and 32 D/ST units of 12', () => {
    expect(pairs).toHaveLength(704)
    expect(units).toHaveLength(32)
    expect(units.every((u) => u.members.length === 12)).toBe(true)
  })

  it('has a projection for every offensive pair and D/ST', () => {
    const offense = pairs.filter((p) => p.fantasyPos !== 'DEF')
    expect(offense).toHaveLength(320)
    expect(offense.every((p) => Number.isFinite(p.projectedPPG))).toBe(true)
    expect(offense.filter((p) => p.projectedPPG > 0).length).toBeGreaterThan(
      300,
    )
    expect(units.every((u) => u.projectedPPG !== 0)).toBe(true)
  })

  it('has weekly points keyed by week', () => {
    const weekly = loadWeeklyPoints()
    expect(weekly.meta.weeks.length).toBeGreaterThan(0)
    for (const w of weekly.meta.weeks) expect(weekly.weeks[w]).toBeDefined()
  })
})

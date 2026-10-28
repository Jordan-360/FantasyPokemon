import { describe, expect, it } from 'vitest'
import { loadDstUnits, loadPairs } from '../data/loaders'
import type { Draftable, DraftPos } from '../types/draft'
import {
  autoPick,
  buildDraftPool,
  chooseCpuPick,
  createDraft,
  createDraftBoard,
  makePick,
  needMultiplier,
  onTheClock,
  openStartingSlots,
  picksUntilNext,
  positionCounts,
  randomDraftOrder,
  recommendedBoard,
  replacementLevels,
  rosterProblems,
  runCpuPicks,
  scarcityByPosition,
  snakeOrder,
  teamRoster,
  vor,
  type ReplacementLevels,
} from './draft'
import { createRng } from './random'

let nextId = 0
function player(pos: DraftPos, projectedPPG = 10, maddenOvr = 80): Draftable {
  const id = `${pos}-${nextId++}`
  return {
    id,
    pos,
    name: id,
    nflName: id,
    team: 'TST',
    projectedPPG,
    maddenOvr,
  }
}
const roster = (...positions: DraftPos[]) => positions.map((p) => player(p))

const ZERO: ReplacementLevels = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 }

describe('snakeOrder', () => {
  it('reverses every other round', () => {
    expect(snakeOrder([2, 0, 1], 3)).toEqual([2, 0, 1, 1, 0, 2, 2, 0, 1])
  })
})

describe('randomDraftOrder', () => {
  it('is a reproducible permutation of every team', () => {
    const a = randomDraftOrder(10, createRng(7))
    expect([...a].sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(randomDraftOrder(10, createRng(7))).toEqual(a)
  })
})

describe('replacementLevels / vor', () => {
  it('uses the Nth best projection at each position', () => {
    const qbs = Array.from({ length: 20 }, (_, i) => player('QB', 30 - i)) // 30..11
    const levels = replacementLevels(qbs)
    expect(levels.QB).toBe(19) // 12th best
    expect(vor(qbs[0], levels)).toBe(11)
  })

  it('falls back to the worst player when a position is thin', () => {
    expect(replacementLevels([player('K', 9), player('K', 7)]).K).toBe(7)
  })
})

describe('needMultiplier', () => {
  const R = 15
  it('is 1.0 for an open starting slot', () => {
    expect(needMultiplier([], 'QB', 1, R)).toBe(1)
    expect(needMultiplier(roster('RB'), 'RB', 2, R)).toBe(1)
  })

  it('counts the FLEX as a starting slot for RB/WR/TE', () => {
    expect(needMultiplier(roster('RB', 'RB'), 'RB', 3, R)).toBe(1)
    expect(
      needMultiplier(roster('TE', 'RB', 'RB', 'WR', 'WR'), 'TE', 6, R),
    ).toBe(1)
  })

  it('scores the 1st bench RB/WR at 0.6 and later ones at 0.4', () => {
    const full = roster('RB', 'RB', 'RB') // third RB is in the FLEX
    expect(needMultiplier(full, 'RB', 4, R)).toBe(0.6)
    expect(needMultiplier([...full, player('RB')], 'RB', 5, R)).toBe(0.4)
    // WR bench depth is counted separately from RB
    expect(
      needMultiplier(roster('RB', 'RB', 'RB', 'WR', 'WR'), 'WR', 6, R),
    ).toBe(0.6)
  })

  it('scores a backup QB/TE at 0.2 and a third at 0', () => {
    expect(needMultiplier(roster('QB'), 'QB', 5, R)).toBe(0.2)
    expect(needMultiplier(roster('QB', 'QB'), 'QB', 6, R)).toBe(0)
    const flexFull = roster('RB', 'RB', 'RB', 'TE')
    expect(needMultiplier(flexFull, 'TE', 6, R)).toBe(0.2)
    expect(needMultiplier([...flexFull, player('TE')], 'TE', 7, R)).toBe(0)
  })

  it('only allows K and D/ST in the final 2 rounds, and only one each', () => {
    expect(needMultiplier([], 'K', 13, R)).toBe(0)
    expect(needMultiplier([], 'K', 14, R)).toBe(1)
    expect(needMultiplier([], 'DST', 15, R)).toBe(1)
    expect(needMultiplier(roster('DST'), 'DST', 15, R)).toBe(0)
  })
})

describe('openStartingSlots', () => {
  it('counts dedicated slots plus the FLEX', () => {
    expect(openStartingSlots([])).toBe(9)
    expect(openStartingSlots(roster('RB', 'RB', 'RB'))).toBe(6)
    expect(openStartingSlots(roster('QB', 'QB'))).toBe(8) // backup QB fills nothing
  })
})

describe('picksUntilNext', () => {
  const state = createDraft([0, 1, 2, 3], { teams: 4, rounds: 3 })
  it('counts the other teams picking in between', () => {
    expect(picksUntilNext(state, 0)).toBe(6) // team 0 picks at 0 and 7
    expect(picksUntilNext(state, 3)).toBe(0) // team 3 picks back-to-back at the turn
  })
  it('is null for a team’s last pick', () => {
    expect(picksUntilNext(state, 11)).toBeNull()
  })
})

describe('scarcityByPosition', () => {
  it('measures VOR lost if the next N best players are taken', () => {
    // Sorted by VOR: RB 20, RB 18, WR 15, RB 5, WR 14 is out of order on purpose? no:
    const available = [
      player('RB', 20),
      player('RB', 18),
      player('WR', 15),
      player('RB', 5),
      player('WR', 4),
    ]
    const s = scarcityByPosition(available, ZERO, 2)
    expect(s.RB).toBe(15) // best RB 20 now, 5 after two picks
    expect(s.WR).toBe(0) // WR 15 is still there after two picks
  })

  it('is zero when the team never picks again', () => {
    expect(scarcityByPosition([player('QB', 20)], ZERO, null).QB).toBe(0)
  })

  it('counts all value above replacement when a position runs out', () => {
    // The one pick in between takes the only QB
    const s = scarcityByPosition([player('QB', 8), player('TE', 7)], ZERO, 1)
    expect(s.QB).toBe(8)
  })
})

describe('chooseCpuPick', () => {
  const settings = { teams: 2, rounds: 15 }

  it('takes the best player for the team, not the best player', () => {
    // Replacement: QB 5, RB 2. QB 29 has more VOR (24) than RB 18 (16),
    // but team 0 already has a QB, so a backup QB only counts 0.2.
    const qbs = [player('QB', 30), player('QB', 29)]
    const rbs = [player('RB', 20), player('RB', 19), player('RB', 18)]
    const pool = [
      ...qbs,
      ...rbs,
      ...Array.from({ length: 10 }, () => player('QB', 5)),
      ...Array.from({ length: 30 }, () => player('RB', 2)),
    ]
    const board = createDraftBoard(pool)
    let state = createDraft([0, 1], settings)
    state = makePick(state, qbs[0].id) // team 0
    state = makePick(state, rbs[0].id) // team 1
    state = makePick(state, rbs[1].id) // team 1 again at the turn
    expect(onTheClock(state)?.teamIndex).toBe(0)
    expect(board.byId.get(qbs[1].id) && vor(qbs[1], board.replacement)).toBe(24)
    expect(chooseCpuPick(board, state).id).toBe(rbs[2].id)
  })

  it('breaks ties with Madden OVR', () => {
    const pool = [player('RB', 10, 70), player('RB', 10, 90)]
    const board = createDraftBoard(pool)
    const state = createDraft([0, 1], settings)
    expect(chooseCpuPick(board, state).maddenOvr).toBe(90)
  })
})

describe('recommendedBoard', () => {
  it('lists available players by plain VOR', () => {
    const pool = [player('K', 9), player('QB', 25), player('RB', 15)]
    const board = createDraftBoard(pool)
    const state = makePick(
      createDraft([0, 1], { teams: 2, rounds: 15 }),
      pool[1].id,
    )
    const ids = recommendedBoard(board, state).map((p) => p.id)
    expect(ids).not.toContain(pool[1].id)
    expect(ids).toHaveLength(2)
  })
})

describe('makePick', () => {
  it('rejects a player who is already drafted', () => {
    const pool = [player('QB'), player('RB')]
    const state = makePick(
      createDraft([0, 1], { teams: 2, rounds: 1 }),
      pool[0].id,
    )
    expect(() => makePick(state, pool[0].id)).toThrow(/already been drafted/)
  })

  it('does not mutate the previous state', () => {
    const state = createDraft([0, 1], { teams: 2, rounds: 1 })
    makePick(state, 'x')
    expect(state.picks).toHaveLength(0)
  })
})

describe('rosterProblems', () => {
  it('passes a full lineup and flags missing or doubled slots', () => {
    const lineup = roster('QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'WR', 'K', 'DST')
    expect(rosterProblems(lineup)).toEqual([])
    expect(rosterProblems([...lineup, player('K')])).toEqual(['2 kickers'])
    expect(rosterProblems(roster('QB'))).toContain('no starter at RB')
  })
})

describe('full 10-team mock draft with real data', () => {
  const board = createDraftBoard(buildDraftPool(loadPairs(), loadDstUnits()))

  function mockDraft(seed: number) {
    const state = createDraft(randomDraftOrder(10, createRng(seed)))
    return runCpuPicks(board, state, null)
  }

  it.each([1, 2, 3, 42, 2026])(
    'seed %i: every team can field a lineup',
    (seed) => {
      const done = mockDraft(seed)
      expect(done.picks).toHaveLength(150)
      expect(new Set(done.picks.map((p) => p.playerId)).size).toBe(150)

      for (let team = 0; team < 10; team++) {
        const r = teamRoster(board, done, team)
        expect(r).toHaveLength(15)
        expect(rosterProblems(r), `team ${team}`).toEqual([])
        const counts = positionCounts(r)
        expect(counts.QB).toBeLessThanOrEqual(2)
        expect(counts.TE).toBeLessThanOrEqual(2)
      }
    },
  )

  it('is deterministic for a given draft order', () => {
    expect(mockDraft(9).picks).toEqual(mockDraft(9).picks)
  })

  it('stops for the human and resumes after their pick', () => {
    const start = createDraft(randomDraftOrder(10, createRng(5)))
    const human = start.order[3]
    const paused = runCpuPicks(board, start, human)
    expect(paused.picks).toHaveLength(3)
    expect(onTheClock(paused)?.teamIndex).toBe(human)

    // Timer expiry: auto-pick uses the CPU logic for the human's roster
    const afterAuto = autoPick(board, paused)
    expect(afterAuto.picks[3].teamIndex).toBe(human)
  })

  it('takes K and D/ST only in the last two rounds', () => {
    const done = mockDraft(11)
    for (const pick of done.picks) {
      const pos = board.byId.get(pick.playerId)!.pos
      if (pos === 'K' || pos === 'DST')
        expect(pick.round).toBeGreaterThanOrEqual(14)
    }
  })
})

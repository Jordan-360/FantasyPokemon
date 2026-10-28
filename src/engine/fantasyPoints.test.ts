import { describe, expect, it } from 'vitest'
import {
  dstPoints,
  kickerPoints,
  projectPPG,
  type DefenseLine,
} from './fantasyPoints'

describe('kickerPoints', () => {
  it('scores ESPN standard distances, PATs and misses', () => {
    // 3 + 4 + 5 + 5 - 1 + 2 = 18
    expect(
      kickerPoints({
        fgMade0to39: 1,
        fgMade40to49: 1,
        fgMade50plus: 2,
        fgMissed: 1,
        patMade: 2,
      }),
    ).toBe(18)
  })
})

describe('dstPoints', () => {
  const quiet: DefenseLine = {
    sacks: 0,
    interceptions: 0,
    fumblesRecovered: 0,
    touchdowns: 0,
    safeties: 0,
    blockedKicks: 0,
    pointsAllowed: 20, // 0 pts tier
    yardsAllowed: 320, // 0 pts tier
  }

  it('scores splash plays', () => {
    expect(
      dstPoints({
        ...quiet,
        sacks: 3,
        interceptions: 1,
        fumblesRecovered: 1,
        touchdowns: 1,
        safeties: 1,
        blockedKicks: 1,
      }),
    ).toBe(3 + 2 + 2 + 6 + 2 + 2)
  })

  it.each([
    [0, 5],
    [6, 4],
    [7, 3],
    [17, 1],
    [27, 0],
    [28, -1],
    [45, -3],
    [46, -5],
  ])('points allowed %i -> %i', (pointsAllowed, expected) => {
    expect(dstPoints({ ...quiet, pointsAllowed })).toBe(expected)
  })

  it.each([
    [99, 5],
    [100, 3],
    [299, 2],
    [350, -1],
    [549, -6],
    [550, -7],
  ])('yards allowed %i -> %i', (yardsAllowed, expected) => {
    expect(dstPoints({ ...quiet, yardsAllowed })).toBe(expected)
  })
})

describe('projectPPG', () => {
  it('blends 65% current and 35% prior, shrinking each by 2 games', () => {
    // current 100 / (8 + 2) = 10, prior 240 / (16 + 2) = 13.33...
    expect(
      projectPPG({ points: 100, games: 8 }, { points: 240, games: 16 }),
    ).toBeCloseTo(0.65 * 10 + 0.35 * (240 / 18))
  })

  it('uses the current season alone without prior games', () => {
    expect(projectPPG({ points: 60, games: 4 }, undefined)).toBe(10)
    expect(projectPPG({ points: 60, games: 4 }, { points: 0, games: 0 })).toBe(
      10,
    )
  })

  it('treats a missing current season as zero', () => {
    expect(projectPPG(undefined, { points: 180, games: 16 })).toBeCloseTo(
      0.35 * 10,
    )
  })
})

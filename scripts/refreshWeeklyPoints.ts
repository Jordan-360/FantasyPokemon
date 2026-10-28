/**
 * Pulls nflverse stats and writes two generated files:
 *
 *   src/data/weekly_points.json  real fantasy points per week, per pair + D/ST
 *   src/data/projections.json    projected PPG per pair + D/ST (draft board)
 *
 * Only the 704 pooled players (src/data/pairs.json) and 32 D/ST units are
 * written. Defensive pairs score through their team's D/ST, not individually.
 *
 * Sources (nflverse-data GitHub releases + nfldata schedules):
 *   stats_player_week_<season>.csv   current-season weekly player stats
 *   stats_player_reg_<season-1>.csv  prior-season player totals
 *   stats_team_week_<season|prior>.csv  team defense, both seasons
 *   games.csv                        final scores, for D/ST points allowed
 *
 * Downloads are cached in .cache/nflverse/. Current-season files are
 * re-downloaded every run; prior-season files only when missing.
 *
 * Run with: npm run refresh:points            (add -- --offline to use cache only)
 */

import fs from 'node:fs'
import path from 'node:path'
import prettier from 'prettier'
import { num, parseCsv, type CsvRow } from './lib/csv.ts'
import {
  dstPoints,
  kickerPoints,
  projectPPG,
  round2,
  type SeasonTotals,
} from '../src/engine/fantasyPoints.ts'
import type { RawPair } from '../src/types/pair.ts'
import type { RawDstUnit } from '../src/types/dst.ts'
import type {
  ProjectionsFile,
  WeekPoints,
  WeeklyPointsFile,
} from '../src/types/points.ts'

const RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download'
const GAMES_URL =
  'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv'
const CACHE_DIR = path.resolve('.cache/nflverse')
const DATA_DIR = path.resolve('src/data')

const offline = process.argv.includes('--offline')

const pairsFile = readJson<{ meta: { season: number }; pairs: RawPair[] }>(
  'pairs.json',
)
const dstUnits = readJson<RawDstUnit[]>('dst_units.json')
const season = pairsFile.meta.season
const prior = season - 1

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf-8')) as T
}

// Formatted with the repo's Prettier config so refreshes don't fight lint-staged
async function writeJson(file: string, data: unknown) {
  const out = path.join(DATA_DIR, file)
  const options = await prettier.resolveConfig(out)
  const text = await prettier.format(JSON.stringify(data), {
    ...options,
    filepath: out,
  })
  fs.writeFileSync(out, text)
  console.log(`wrote ${path.relative(process.cwd(), out)}`)
}

async function loadCsv(url: string, alwaysRefresh: boolean): Promise<CsvRow[]> {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cacheFile = path.join(CACHE_DIR, path.basename(url))
  const cached = fs.existsSync(cacheFile)

  if (!cached || (alwaysRefresh && !offline)) {
    if (offline) throw new Error(`--offline but ${cacheFile} is not cached`)
    console.log(`downloading ${url}`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`)
    fs.writeFileSync(cacheFile, await res.text())
  }
  return parseCsv(fs.readFileSync(cacheFile, 'utf-8'))
}

const isRegular = (r: CsvRow) =>
  r.season_type === 'REG' || r.game_type === 'REG'

// --- Player scoring -------------------------------------------------------

function kickingFromRow(r: CsvRow): number {
  return kickerPoints({
    fgMade0to39:
      num(r.fg_made_0_19) + num(r.fg_made_20_29) + num(r.fg_made_30_39),
    fgMade40to49: num(r.fg_made_40_49),
    fgMade50plus: num(r.fg_made_50_59) + num(r.fg_made_60_),
    fgMissed: num(r.fg_missed),
    patMade: num(r.pat_made),
  })
}

// Defensive pairs aren't scored individually, so they're left out here
const scoredPairs = pairsFile.pairs.filter((p) => p.fantasyPos !== 'DEF')
const posById = new Map(scoredPairs.map((p) => [p.nfl.gsisId, p.fantasyPos]))

function playerPoints(r: CsvRow): number | undefined {
  const pos = posById.get(r.player_id)
  if (!pos) return undefined
  return pos === 'K' ? kickingFromRow(r) : num(r.fantasy_points_ppr)
}

// --- D/ST scoring ---------------------------------------------------------

function scoreLookup(games: CsvRow[]): Map<string, number> {
  // `${game_id}|${team}` -> points that team allowed
  const allowed = new Map<string, number>()
  for (const g of games) {
    if (g.home_score === '' || g.away_score === '') continue
    allowed.set(`${g.game_id}|${g.home_team}`, num(g.away_score))
    allowed.set(`${g.game_id}|${g.away_team}`, num(g.home_score))
  }
  return allowed
}

// Returns one entry per team-game: { team, week, points }
function dstGames(teamRows: CsvRow[], allowed: Map<string, number>) {
  const byGameTeam = new Map(teamRows.map((r) => [`${r.game_id}|${r.team}`, r]))
  const out: { team: string; week: number; points: number }[] = []

  for (const r of teamRows) {
    const opp = byGameTeam.get(`${r.game_id}|${r.opponent_team}`)
    const pointsAllowed = allowed.get(`${r.game_id}|${r.team}`)
    if (!opp || pointsAllowed === undefined) {
      console.warn(
        `skipping D/ST ${r.team} ${r.game_id}: missing opponent data`,
      )
      continue
    }
    const yardsAllowed =
      num(opp.passing_yards) -
      Math.abs(num(opp.sack_yards_lost)) +
      num(opp.rushing_yards)

    out.push({
      team: r.team,
      week: num(r.week),
      points: dstPoints({
        sacks: num(r.def_sacks),
        interceptions: num(r.def_interceptions),
        fumblesRecovered: num(r.fumble_recovery_opp),
        touchdowns: num(r.def_tds) + num(r.special_teams_tds),
        safeties: num(r.def_safeties),
        blockedKicks:
          num(r.def_fg_blocks) + num(r.def_punt_blocks) + num(r.def_pat_blocks),
        pointsAllowed,
        yardsAllowed,
      }),
    })
  }
  return out
}

function addTo(totals: Map<string, SeasonTotals>, key: string, points: number) {
  const t = totals.get(key) ?? { points: 0, games: 0 }
  t.points += points
  t.games += 1
  totals.set(key, t)
}

// --- Main -----------------------------------------------------------------

async function main() {
  const [playerWeeks, playerPrior, teamWeeks, teamPrior, games] =
    await Promise.all([
      loadCsv(`${RELEASES}/stats_player/stats_player_week_${season}.csv`, true),
      loadCsv(`${RELEASES}/stats_player/stats_player_reg_${prior}.csv`, false),
      loadCsv(`${RELEASES}/stats_team/stats_team_week_${season}.csv`, true),
      loadCsv(`${RELEASES}/stats_team/stats_team_week_${prior}.csv`, false),
      loadCsv(GAMES_URL, true),
    ])
  const allowed = scoreLookup(games.filter(isRegular))

  const weeks: Record<string, WeekPoints> = {}
  const weekOf = (w: number) => (weeks[w] ??= { players: {}, dst: {} })

  // Current season: weekly points + running totals for projections
  const playerCur = new Map<string, SeasonTotals>()
  for (const r of playerWeeks.filter(isRegular)) {
    const pts = playerPoints(r)
    if (pts === undefined) continue
    weekOf(num(r.week)).players[r.player_id] = round2(pts)
    addTo(playerCur, r.player_id, pts)
  }

  const dstCur = new Map<string, SeasonTotals>()
  for (const g of dstGames(teamWeeks.filter(isRegular), allowed)) {
    weekOf(g.week).dst[g.team] = round2(g.points)
    addTo(dstCur, g.team, g.points)
  }

  // Prior season totals. The player file is already season totals.
  const playerPri = new Map<string, SeasonTotals>()
  for (const r of playerPrior.filter(isRegular)) {
    const pts = playerPoints(r)
    if (pts !== undefined) {
      playerPri.set(r.player_id, { points: pts, games: num(r.games) })
    }
  }
  const dstPri = new Map<string, SeasonTotals>()
  for (const g of dstGames(teamPrior.filter(isRegular), allowed)) {
    addTo(dstPri, g.team, g.points)
  }

  const generatedAt = new Date().toISOString()
  const weekNumbers = Object.keys(weeks)
    .map(Number)
    .sort((a, b) => a - b)
  const weeklyFile: WeeklyPointsFile = {
    meta: {
      generatedAt,
      season,
      source: 'nflverse stats_player_week + stats_team_week + nfldata games',
      weeks: weekNumbers,
    },
    weeks: Object.fromEntries(weekNumbers.map((w) => [w, weeks[w]])),
  }

  const projections: ProjectionsFile = {
    meta: {
      generatedAt,
      season,
      source: `nflverse ${season} REG weeks ${weekNumbers.join(',')} + ${prior} REG`,
      method: `per-game points: 65% ${season} + 35% ${prior}, each points / (games + 2)`,
    },
    players: Object.fromEntries(
      scoredPairs.map((p) => [
        p.nfl.gsisId,
        round2(
          projectPPG(playerCur.get(p.nfl.gsisId), playerPri.get(p.nfl.gsisId)),
        ),
      ]),
    ),
    dst: Object.fromEntries(
      dstUnits.map((u) => [
        u.team,
        round2(projectPPG(dstCur.get(u.team), dstPri.get(u.team))),
      ]),
    ),
  }

  await writeJson('weekly_points.json', weeklyFile)
  await writeJson('projections.json', projections)
  console.log(
    `weeks ${weekNumbers.join(', ')}; ${scoredPairs.length} players, ${dstUnits.length} D/ST`,
  )
}

main().catch((err: unknown) => {
  console.error(err)
  process.exit(1)
})

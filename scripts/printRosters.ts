/**
 * Reads mappings.json and prints a team-by-team roster breakdown.
 * Outputs to stdout and src/data/rosters-table.txt.
 *
 * Run with: npx tsx scripts/printRosters.ts
 */

import fs from 'fs'
import { Mapping } from '../src/types/matching.js'

const MAPPINGS_FILE = 'src/data/mappings.json'
const OUT_FILE = 'src/data/rosters-table.txt'

const OFFENSE_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K']
const DEFENSE_POSITIONS = ['DL', 'LB', 'CB', 'S']

const POSITION_ORDER = [...OFFENSE_POSITIONS, ...DEFENSE_POSITIONS]

const NFL_TEAMS: Record<string, string> = {
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB: 'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs',
  LAC: 'LA Chargers',
  LAR: 'LA Rams',
  LV: 'Las Vegas Raiders',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE: 'New England Patriots',
  NO: 'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers',
  TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WAS: 'Washington Commanders',
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)
}

function formatScore(n: number): string {
  return n.toFixed(4)
}

function buildRosterLines(mappings: Mapping[]): string[] {
  const lines: string[] = []

  // Group by team
  const byTeam = new Map<string, Mapping[]>()
  for (const m of mappings) {
    if (!byTeam.has(m.team)) byTeam.set(m.team, [])
    byTeam.get(m.team)!.push(m)
  }

  const sortedTeams = [...byTeam.keys()].sort()

  for (const team of sortedTeams) {
    const fullName = NFL_TEAMS[team] ?? team
    const header = `${fullName} (${team})`
    lines.push('='.repeat(70))
    lines.push(header)
    lines.push('='.repeat(70))

    const roster = byTeam.get(team)!
    roster.sort(
      (a, b) =>
        POSITION_ORDER.indexOf(a.position) - POSITION_ORDER.indexOf(b.position),
    )

    // Offense
    const offense = roster.filter((m) => OFFENSE_POSITIONS.includes(m.position))
    lines.push('OFFENSE')
    for (const m of offense) {
      lines.push(
        `  ${pad(m.position, 4)} ${pad(m.pokemon, 20)} ${pad(m.player, 28)} ${formatScore(m.fitScore)}`,
      )
    }

    // Defense
    const defense = roster.filter((m) => DEFENSE_POSITIONS.includes(m.position))
    lines.push('DEFENSE')
    for (const m of defense) {
      lines.push(
        `  ${pad(m.position, 4)} ${pad(m.pokemon, 20)} ${pad(m.player, 28)} ${formatScore(m.fitScore)}`,
      )
    }

    lines.push('')
  }

  return lines
}

async function main() {
  if (!fs.existsSync(MAPPINGS_FILE)) {
    throw new Error(
      `Missing ${MAPPINGS_FILE} — run scripts/runMatching.ts first`,
    )
  }

  const mappings: Mapping[] = JSON.parse(
    fs.readFileSync(MAPPINGS_FILE, 'utf-8'),
  )
  console.log(`Loaded ${mappings.length} mappings`)

  const lines = buildRosterLines(mappings)
  const output = lines.join('\n')

  console.log('\n' + output)
  fs.writeFileSync(OUT_FILE, output)
  console.log(`\nWrote rosters to ${OUT_FILE}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

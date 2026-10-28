/**
 * Fetches active NFL players from Sleeper's public API and writes the result
 * to src/data/nflPlayers.json.
 *
 * Filters:
 *   1. Active status, on a roster.
 *   2. Non-OL/LS/P positions.
 *   3. First-string only: for each (team, position) group, keeps the top N
 *      players by searchRank (lower = better). Roughly 22 per team × 32 teams
 *      = 704 players, matching the number of base-form Pokémon.
 *
 * Position normalization: DT/DE → DL, OLB/ILB/MLB → LB, FS/SS → S.
 *
 * Run with: npx tsx scripts/fetchPlayers.ts
 */

import fs from 'fs'
import { NFLPlayer } from '../src/types/player.js'

const SLEEPER_URL = 'https://api.sleeper.app/v1/players/nfl'
const OUT_FILE = 'src/data/nflPlayers.json'

// Positions to exclude entirely (offensive line, long snapper, punter)
const EXCLUDED_POSITIONS = new Set(['OT', 'OG', 'C', 'OL', 'LS', 'P', 'G', 'T'])

// How many first-string players to keep per (team, position) group.
// 1+2+4+2+1+4+3+3+2 = 22 per team × 32 teams = 704 max.
const STARTERS_PER_POSITION: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 4,
  TE: 2,
  K: 1,
  DL: 4,
  LB: 3,
  CB: 3,
  S: 2,
}

// Normalize Sleeper's granular positions into the 9 positions used by the app
function normalizePosition(raw: string): string | null {
  switch (raw) {
    case 'QB':
      return 'QB'
    case 'RB':
      return 'RB'
    case 'WR':
      return 'WR'
    case 'TE':
      return 'TE'
    case 'K':
      return 'K'
    case 'DT':
    case 'DE':
      return 'DL'
    case 'LB':
    case 'OLB':
    case 'ILB':
    case 'MLB':
      return 'LB'
    case 'CB':
      return 'CB'
    case 'S':
    case 'FS':
    case 'SS':
      return 'S'
    default:
      return null // excluded or unknown
  }
}

// Raw shape from Sleeper API (only the fields we care about)
interface SleeperPlayer {
  player_id: string
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
  height?: string // "6'2\"" format
  weight?: string // "225" format
  age?: number
  search_rank?: number
  status?: string
  active?: boolean
}

// Parse Sleeper height strings like "6'2\"" or "74" into inches
function parseHeight(raw: string | undefined): number | null {
  if (!raw) return null
  const feetInches = raw.match(/^(\d+)'(\d+)/)
  if (feetInches) return parseInt(feetInches[1]) * 12 + parseInt(feetInches[2])
  const inches = parseInt(raw)
  return isNaN(inches) ? null : inches
}

function parseWeight(raw: string | undefined): number | null {
  if (!raw) return null
  const lbs = parseInt(raw)
  return isNaN(lbs) ? null : lbs
}

async function main() {
  console.log('Fetching NFL players from Sleeper…')
  const res = await fetch(SLEEPER_URL)
  if (!res.ok) throw new Error(`Sleeper API ${res.status}`)

  const raw = (await res.json()) as Record<string, SleeperPlayer>
  const entries = Object.values(raw)
  console.log(`Total players in Sleeper response: ${entries.length}`)

  const players: NFLPlayer[] = []
  const skipped = { inactive: 0, noTeam: 0, excluded: 0, unknown: 0 }

  for (const p of entries) {
    // Must be active
    if (p.status !== 'Active') {
      skipped.inactive++
      continue
    }

    // Must be rostered on a team
    if (!p.team) {
      skipped.noTeam++
      continue
    }

    const rawPos = p.position ?? ''

    // Drop excluded positions before normalization
    if (EXCLUDED_POSITIONS.has(rawPos)) {
      skipped.excluded++
      continue
    }

    const position = normalizePosition(rawPos)
    if (!position) {
      skipped.unknown++
      continue
    }

    const name =
      p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()

    players.push({
      playerId: p.player_id,
      name,
      position,
      team: p.team,
      height: parseHeight(p.height),
      weight: parseWeight(p.weight),
      age: p.age ?? null,
      // null search_rank → large sentinel so these sort to the bottom of preference lists
      searchRank: p.search_rank ?? 99999,
    })
  }

  // --- First-string filter ---
  // For each (team, position) group, keep the top N players by searchRank.
  const grouped: Record<string, NFLPlayer[]> = {}
  for (const p of players) {
    const key = `${p.team}:${p.position}`
    grouped[key] ??= []
    grouped[key].push(p)
  }

  const firstString: NFLPlayer[] = []
  for (const [key, group] of Object.entries(grouped)) {
    const pos = key.split(':')[1]
    const limit = STARTERS_PER_POSITION[pos] ?? 0
    if (limit === 0) continue
    group.sort((a, b) => a.searchRank - b.searchRank)
    firstString.push(...group.slice(0, limit))
  }

  // Sort the final list by searchRank ascending (best players first)
  firstString.sort((a, b) => a.searchRank - b.searchRank)

  fs.writeFileSync(OUT_FILE, JSON.stringify(firstString, null, 2))

  // Position breakdown for a quick sanity check
  const byPos: Record<string, number> = {}
  for (const p of firstString) byPos[p.position] = (byPos[p.position] ?? 0) + 1

  console.log(`\nAll eligible players: ${players.length}`)
  console.log(`First-string kept:    ${firstString.length}`)
  console.log('Skipped (pre-filter):', skipped)
  console.log('By position:', byPos)
  console.log(`\nWrote ${firstString.length} players to ${OUT_FILE}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

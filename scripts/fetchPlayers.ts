/**
 * Fetches active NFL players from Sleeper's public API and writes the result
 * to src/data/nflPlayers.json.
 *
 * Filters: active status, on a team, non-OL/LS/P positions.
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

  // Sort by searchRank ascending (best players first) for readability
  players.sort((a, b) => a.searchRank - b.searchRank)

  fs.writeFileSync(OUT_FILE, JSON.stringify(players, null, 2))

  // Position breakdown for a quick sanity check
  const byPos: Record<string, number> = {}
  for (const p of players) byPos[p.position] = (byPos[p.position] ?? 0) + 1

  console.log(`\nWrote ${players.length} players to ${OUT_FILE}`)
  console.log('Skipped:', skipped)
  console.log('By position:', byPos)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

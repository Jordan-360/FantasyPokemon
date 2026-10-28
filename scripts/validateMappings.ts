/**
 * Validates src/data/mappings.json for integrity and prints a sanity-check
 * summary. Exits with code 1 if any errors are found.
 *
 * Run with: npx tsx scripts/validateMappings.ts
 */

import fs from 'fs'
import { Pokemon } from '../src/types/pokemon.js'
import { NFLPlayer } from '../src/types/player.js'
import { Mapping } from '../src/types/matching.js'

const POKEMON_FILE = 'src/data/pokemon.json'
const PLAYERS_FILE = 'src/data/nflPlayers.json'
const MAPPINGS_FILE = 'src/data/mappings.json'

function load<T>(path: string): T {
  if (!fs.existsSync(path)) throw new Error(`Missing file: ${path}`)
  return JSON.parse(fs.readFileSync(path, 'utf-8')) as T
}

function main() {
  const pokemon = load<Pokemon[]>(POKEMON_FILE)
  const players = load<NFLPlayer[]>(PLAYERS_FILE)
  const mappings = load<Mapping[]>(MAPPINGS_FILE)

  const errors: string[] = []

  // --- Build lookup sets ---
  const pokemonFormIds = new Set(pokemon.map((m) => m.formId))
  const playerIds = new Set(players.map((p) => p.playerId))

  // --- Check for duplicate Pokémon ---
  const seenFormIds = new Set<string>()
  for (const m of mappings) {
    if (seenFormIds.has(m.formId)) errors.push(`Duplicate formId: ${m.formId}`)
    seenFormIds.add(m.formId)
  }

  // --- Check for duplicate players ---
  const seenPlayerIds = new Set<string>()
  for (const m of mappings) {
    if (seenPlayerIds.has(m.playerId))
      errors.push(`Duplicate playerId: ${m.playerId} (${m.player})`)
    seenPlayerIds.add(m.playerId)
  }

  // --- Check referential integrity ---
  for (const m of mappings) {
    if (!pokemonFormIds.has(m.formId))
      errors.push(`Unknown formId in mappings: ${m.formId}`)
    if (!playerIds.has(m.playerId))
      errors.push(`Unknown playerId in mappings: ${m.playerId}`)
  }

  // --- Report errors ---
  if (errors.length > 0) {
    console.error('\n❌ Validation errors:')
    errors.forEach((e) => console.error('  ' + e))
    console.error('')
    process.exit(1)
  }
  console.log('✅ No integrity errors found\n')

  // --- Position coverage table ---
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'CB', 'S']
  const matchedByPos: Record<string, number> = {}
  const totalByPos: Record<string, number> = {}

  for (const p of players) {
    totalByPos[p.position] = (totalByPos[p.position] ?? 0) + 1
  }
  for (const m of mappings) {
    matchedByPos[m.position] = (matchedByPos[m.position] ?? 0) + 1
  }

  console.log('Position coverage:')
  console.log('  Position  Matched  Total Players  % Matched')
  console.log('  ' + '-'.repeat(46))
  for (const pos of positions) {
    const matched = matchedByPos[pos] ?? 0
    const total = totalByPos[pos] ?? 0
    const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : '—'
    console.log(
      `  ${pos.padEnd(9)} ${String(matched).padStart(7)}  ${String(total).padStart(13)}  ${String(pct).padStart(9)}%`,
    )
  }

  // --- D/ST warning: teams with zero defensive Pokémon ---
  const defensivePositions = new Set(['DL', 'LB', 'CB', 'S'])
  const teamsWithDefense = new Set(
    mappings
      .filter((m) => defensivePositions.has(m.position))
      .map((m) => m.team),
  )
  const allTeams = new Set(players.map((p) => p.team))
  const noDefense = [...allTeams].filter((t) => !teamsWithDefense.has(t)).sort()

  if (noDefense.length > 0) {
    console.log(
      `\n⚠️  Teams with no defensive (DL/LB/CB/S) Pokémon mapped (${noDefense.length}):`,
    )
    console.log('  ' + noDefense.join(', '))
  } else {
    console.log('\n✅ All teams have at least one defensive Pokémon')
  }

  // --- Top 20 matches by fitScore ---
  const top20 = [...mappings]
    .sort((a, b) => b.fitScore - a.fitScore)
    .slice(0, 20)
  console.log('\nTop 20 matches by fitScore:')
  console.log('  #   Score   Pos  Pokémon → Player (Team)')
  console.log('  ' + '-'.repeat(62))
  top20.forEach((m, i) => {
    const rank = String(i + 1).padStart(2)
    const score = m.fitScore.toFixed(4)
    const pos = m.position.padEnd(4)
    console.log(
      `  ${rank}  ${score}  ${pos}  ${m.pokemon} → ${m.player} (${m.team})`,
    )
  })

  // --- 20 random matches ---
  // Fisher-Yates shuffle on a copy, then take 20
  const shuffled = [...mappings]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  const random20 = shuffled.slice(0, 20)

  console.log('\n20 random matches:')
  console.log('  Score   Pos  Pokémon → Player (Team)')
  console.log('  ' + '-'.repeat(58))
  random20.forEach((m) => {
    const score = m.fitScore.toFixed(4)
    const pos = m.position.padEnd(4)
    console.log(`  ${score}  ${pos}  ${m.pokemon} → ${m.player} (${m.team})`)
  })

  console.log(`\nTotal: ${mappings.length} matched pairs`)
}

main()

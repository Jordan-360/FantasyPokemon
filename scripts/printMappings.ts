/**
 * Prints the full mapping table to both the terminal and
 * src/data/mappings-table.txt, sorted by fitScore descending.
 *
 * Run with: npx tsx scripts/printMappings.ts
 */

import fs from 'fs'
import { Mapping } from '../src/types/matching.js'

const MAPPINGS_FILE = 'src/data/mappings.json'
const OUT_FILE = 'src/data/mappings-table.txt'

function main() {
  if (!fs.existsSync(MAPPINGS_FILE)) {
    console.error(`Missing ${MAPPINGS_FILE} — run scripts/runMatching.ts first`)
    process.exit(1)
  }

  const mappings: Mapping[] = JSON.parse(
    fs.readFileSync(MAPPINGS_FILE, 'utf-8'),
  )
  mappings.sort((a, b) => b.fitScore - a.fitScore)

  const header =
    '#'.padEnd(5) +
    'Score '.padEnd(8) +
    'Pos  ' +
    'Pokémon'.padEnd(22) +
    'Player'.padEnd(28) +
    'Team'

  const divider = '-'.repeat(header.length)

  const rows = mappings.map((m, i) => {
    const rank = String(i + 1).padEnd(5)
    const score = m.fitScore.toFixed(4).padEnd(8)
    const pos = m.position.padEnd(5)
    const pokemon = m.pokemon.padEnd(22)
    const player = m.player.padEnd(28)
    return rank + score + pos + pokemon + player + m.team
  })

  const lines = [
    header,
    divider,
    ...rows,
    '',
    `Total: ${mappings.length} matched pairs`,
  ]
  const output = lines.join('\n')

  console.log(output)
  fs.writeFileSync(OUT_FILE, output)
  console.log(`\nSaved to ${OUT_FILE}`)
}

main()

/**
 * Runs the Gale-Shapley stable matching algorithm over the fetched Pokémon
 * and NFL player data and writes the result to src/data/mappings.json.
 *
 * Prerequisites: run fetchPokemon.ts and fetchPlayers.ts first.
 * Run with: npx tsx scripts/runMatching.ts
 */

import fs from 'fs'
import { Pokemon } from '../src/types/pokemon.js'
import { NFLPlayer } from '../src/types/player.js'
import { Mapping } from '../src/types/matching.js'
import {
  SCORING_CONFIG,
  buildScoringContext,
  fitScore,
  galeShapley,
} from '../src/engine/matching.js'

const POKEMON_FILE = 'src/data/pokemon.json'
const PLAYERS_FILE = 'src/data/nflPlayers.json'
const OUT_FILE = 'src/data/mappings.json'

function requireFile(path: string) {
  if (!fs.existsSync(path)) {
    throw new Error(
      `Missing ${path} — run the fetch scripts first:\n  npx tsx scripts/fetchPokemon.ts\n  npx tsx scripts/fetchPlayers.ts`,
    )
  }
}

async function main() {
  requireFile(POKEMON_FILE)
  requireFile(PLAYERS_FILE)

  const pokemon: Pokemon[] = JSON.parse(fs.readFileSync(POKEMON_FILE, 'utf-8'))
  const players: NFLPlayer[] = JSON.parse(
    fs.readFileSync(PLAYERS_FILE, 'utf-8'),
  )

  console.log(`Loaded ${pokemon.length} Pokémon, ${players.length} players`)

  const ctx = buildScoringContext(players, pokemon)
  console.log('Scoring context built')
  console.log(`  BST range: ${ctx.bstRange.min} – ${ctx.bstRange.max}`)
  console.log(
    `  searchRank range: ${ctx.playerRankRange.min} – ${ctx.playerRankRange.max}`,
  )

  // Run the stable matching algorithm
  const matched = galeShapley(pokemon, players, ctx, SCORING_CONFIG)
  console.log(`Stable matching complete: ${matched.size} pairs`)

  // Build lookup maps for assembling the output
  const pokemonByFormId = new Map<string, Pokemon>(
    pokemon.map((m) => [m.formId, m]),
  )
  const playerById = new Map<string, NFLPlayer>(
    players.map((p) => [p.playerId, p]),
  )

  const mappings: Mapping[] = []
  for (const [formId, playerId] of matched) {
    const mon = pokemonByFormId.get(formId)!
    const player = playerById.get(playerId)!
    const score = fitScore(mon, player, ctx, SCORING_CONFIG)

    mappings.push({
      pokedexId: mon.pokedexId,
      formId: mon.formId,
      pokemon: mon.name,
      playerId: player.playerId,
      player: player.name,
      position: player.position,
      team: player.team,
      fitScore: Math.round(score * 10000) / 10000, // 4 decimal places
    })
  }

  // Sort by fitScore descending so the file reads best-to-worst
  mappings.sort((a, b) => b.fitScore - a.fitScore)

  fs.writeFileSync(OUT_FILE, JSON.stringify(mappings, null, 2))
  console.log(`\nWrote ${mappings.length} mappings to ${OUT_FILE}`)

  // Quick position breakdown
  const byPos: Record<string, number> = {}
  for (const m of mappings) byPos[m.position] = (byPos[m.position] ?? 0) + 1
  console.log('By position:', byPos)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

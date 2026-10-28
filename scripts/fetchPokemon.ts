/**
 * Fetches every Pokémon form from PokeAPI (all generations, including Megas,
 * regional variants, Gigantamax, and other alternate forms) and writes the
 * result to src/data/pokemon.json.
 *
 * Caching: each raw PokeAPI response is saved to .cache/pokemon/<slug>.json so
 * reruns don't refetch already-downloaded data. Only missing slugs hit the
 * network.
 *
 * Run with: npx tsx scripts/fetchPokemon.ts
 */

import fs from 'fs'
import path from 'path'
import { Pokemon } from '../src/types/pokemon.js'

const POKEAPI = 'https://pokeapi.co/api/v2'
const CACHE_DIR = path.resolve('.cache/pokemon')
const OUT_FILE = path.resolve('src/data/pokemon.json')
// Polite delay between uncached requests (ms)
const REQUEST_DELAY_MS = 150

// PokeAPI stat name → our field name
const STAT_MAP: Record<string, keyof Pokemon> = {
  hp: 'hp',
  attack: 'attack',
  defense: 'defense',
  'special-attack': 'spAttack',
  'special-defense': 'spDefense',
  speed: 'speed',
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// Read from cache if present; otherwise fetch and cache.
async function cachedFetch(slug: string, url: string): Promise<unknown> {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cacheFile = path.join(CACHE_DIR, `${slug}.json`)

  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
  }

  await sleep(REQUEST_DELAY_MS)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`PokeAPI ${res.status}: ${url}`)
  const data = await res.json()
  fs.writeFileSync(cacheFile, JSON.stringify(data))
  return data
}

interface PokeAPINamedResource {
  name: string
  url: string
}

interface PokeAPIPokemonListResponse {
  count: number
  results: PokeAPINamedResource[]
}

interface PokeAPIPokemon {
  id: number
  name: string
  types: { slot: number; type: PokeAPINamedResource }[]
  stats: { base_stat: number; stat: PokeAPINamedResource }[]
  height: number
  weight: number
  species: PokeAPINamedResource
}

// Extract the species (pokedex) id from a species URL like
// https://pokeapi.co/api/v2/pokemon-species/6/
function speciesIdFromUrl(url: string): number {
  const parts = url.replace(/\/$/, '').split('/')
  return parseInt(parts[parts.length - 1], 10)
}

// Build a display name from the PokeAPI slug.
// "charizard-mega-x" → "Charizard Mega X"
// "rattata-alola" → "Rattata (Alola)"
function formatName(slug: string): string {
  const REGIONAL_SUFFIXES = ['alola', 'galar', 'hisui', 'paldea']
  const parts = slug.split('-')

  // Check for regional suffix at the end
  const lastPart = parts[parts.length - 1]
  if (REGIONAL_SUFFIXES.includes(lastPart)) {
    const baseName = parts.slice(0, -1).map(capitalize).join(' ')
    return `${baseName} (${capitalize(lastPart)})`
  }

  return parts.map(capitalize).join(' ')
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

async function main() {
  // Step 1: get the full list of all pokemon form slugs from PokeAPI.
  // /pokemon?limit=2000 returns every entry (base forms + alt forms) in one page.
  console.log('Fetching Pokémon index…')
  const listData = (await cachedFetch(
    '__pokemon_list',
    `${POKEAPI}/pokemon?limit=2000`,
  )) as PokeAPIPokemonListResponse

  const slugs = listData.results.map((r) => r.name)
  console.log(`Found ${slugs.length} Pokémon forms in index`)

  const pokemon: Pokemon[] = []
  let fetched = 0
  let fromCache = 0

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    const cacheFile = path.join(CACHE_DIR, `${slug}.json`)
    const wasCached = fs.existsSync(cacheFile)

    let data: PokeAPIPokemon
    try {
      data = (await cachedFetch(
        slug,
        `${POKEAPI}/pokemon/${slug}`,
      )) as PokeAPIPokemon
    } catch (err) {
      console.warn(`  Skipping ${slug}: ${(err as Error).message}`)
      continue
    }

    if (wasCached) {
      fromCache++
    } else {
      fetched++
    }

    // Extract stats
    const stats: Partial<Record<keyof Pokemon, number>> = {}
    for (const s of data.stats) {
      const field = STAT_MAP[s.stat.name]
      if (field) stats[field] = s.base_stat
    }

    // Require all six stats to be present
    const required: (keyof Pokemon)[] = [
      'hp',
      'attack',
      'defense',
      'spAttack',
      'spDefense',
      'speed',
    ]
    if (required.some((k) => stats[k] === undefined)) {
      console.warn(`  Skipping ${slug}: missing stats`)
      continue
    }

    // Resolve species (pokedex) id from the species URL
    const pokedexId = speciesIdFromUrl(data.species.url)

    // Extract types (always 1 or 2)
    const types = data.types
      .sort((a, b) => a.slot - b.slot)
      .map((t) => t.type.name) as [string] | [string, string]

    pokemon.push({
      pokedexId,
      formId: slug,
      name: formatName(slug),
      types,
      hp: stats.hp!,
      attack: stats.attack!,
      defense: stats.defense!,
      spAttack: stats.spAttack!,
      spDefense: stats.spDefense!,
      speed: stats.speed!,
      height: data.height,
      weight: data.weight,
    })

    if ((i + 1) % 100 === 0) {
      console.log(`  ${i + 1}/${slugs.length} processed…`)
    }
  }

  // Sort by pokedexId, then formId so the file is stable across reruns
  pokemon.sort(
    (a, b) => a.pokedexId - b.pokedexId || a.formId.localeCompare(b.formId),
  )

  fs.writeFileSync(OUT_FILE, JSON.stringify(pokemon, null, 2))
  console.log(
    `\nWrote ${pokemon.length} Pokémon to src/data/pokemon.json`,
    `(${fetched} fetched, ${fromCache} from cache)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

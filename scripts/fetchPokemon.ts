/**
 * Fetches one base-form Pokémon per species across all generations and writes
 * the result to src/data/pokemon.json.
 *
 * Strategy: pull the full species list from /pokemon-species, then fetch
 * /pokemon/{species-name} for each entry. The species name is the same slug
 * as the default (base) form, so Megas, regional variants, Gigantamax forms,
 * etc. are automatically excluded.
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
// Only include Pokémon from Generations 1–6 (Bulbasaur → Volcanion, #1–721).
// Gen 7+ introduces extreme outliers (Regieleki Speed 200, Ultra Beasts, etc.)
// that dominate the top matches and leave mid-tier Pokémon mismatched.
const MAX_POKEDEX_ID = 721

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
// Returns null (instead of throwing) when the server responds with 404.
async function cachedFetch(slug: string, url: string): Promise<unknown | null> {
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const cacheFile = path.join(CACHE_DIR, `${slug}.json`)

  if (fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, 'utf-8'))
  }

  await sleep(REQUEST_DELAY_MS)
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`PokeAPI ${res.status}: ${url}`)
  const data = await res.json()
  fs.writeFileSync(cacheFile, JSON.stringify(data))
  return data
}

// Some species have a default form slug that differs from the species name
// (e.g. "deoxys" → "deoxys-normal", "giratina" → "giratina-altered").
// This fetches the species detail and returns the is_default variety's slug.
async function resolveDefaultFormSlug(
  speciesSlug: string,
): Promise<string | null> {
  const species = (await cachedFetch(
    `__species_${speciesSlug}`,
    `${POKEAPI}/pokemon-species/${speciesSlug}`,
  )) as PokeAPISpecies | null
  if (!species) return null
  const defaultVariety = species.varieties.find((v) => v.is_default)
  return defaultVariety?.pokemon.name ?? null
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

interface PokeAPISpecies {
  varieties: { is_default: boolean; pokemon: PokeAPINamedResource }[]
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
  // Step 1: get the species list — one entry per Pokémon, all generations.
  // Species names double as the default-form pokemon slugs, so fetching
  // /pokemon/{species-name} always returns the base form (not a mega, etc.).
  console.log('Fetching Pokémon species list…')
  const listData = (await cachedFetch(
    '__species_list',
    `${POKEAPI}/pokemon-species?limit=1500`,
  )) as PokeAPIPokemonListResponse

  // The species list is ordered by pokedex id, so we can slice at MAX_POKEDEX_ID.
  const slugs = listData.results.slice(0, MAX_POKEDEX_ID).map((r) => r.name)
  console.log(
    `Found ${slugs.length} species (Gen 1–6, pokedex #1–${MAX_POKEDEX_ID})`,
  )

  const pokemon: Pokemon[] = []
  let fetched = 0
  let fromCache = 0

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i]
    const cacheFile = path.join(CACHE_DIR, `${slug}.json`)
    const wasCached = fs.existsSync(cacheFile)

    // Try the species name as the pokemon slug first (works for most Pokémon).
    // If the API returns 404, some species use a different default-form slug
    // (e.g. "deoxys" → "deoxys-normal"). Look it up via the species endpoint.
    let pokemonSlug = slug
    let rawData = await cachedFetch(slug, `${POKEAPI}/pokemon/${slug}`)

    if (rawData === null) {
      const resolved = await resolveDefaultFormSlug(slug)
      if (!resolved) {
        console.warn(`  Skipping ${slug}: no default form found`)
        continue
      }
      pokemonSlug = resolved
      rawData = await cachedFetch(
        pokemonSlug,
        `${POKEAPI}/pokemon/${pokemonSlug}`,
      )
      if (rawData === null) {
        console.warn(
          `  Skipping ${slug}: resolved to ${pokemonSlug} but still 404`,
        )
        continue
      }
    }

    let data: PokeAPIPokemon
    try {
      data = rawData as PokeAPIPokemon
    } catch (err) {
      console.warn(`  Skipping ${slug}: ${(err as Error).message}`)
      continue
    }
    void pokemonSlug // used for cache key above; data.name is the canonical slug

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

  // Sort by pokedexId so the file is stable across reruns
  pokemon.sort((a, b) => a.pokedexId - b.pokedexId)

  fs.writeFileSync(OUT_FILE, JSON.stringify(pokemon, null, 2))
  console.log(
    `\nWrote ${pokemon.length} Pokémon (Gen 1–6) to src/data/pokemon.json`,
    `(${fetched} fetched, ${fromCache} from cache)`,
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

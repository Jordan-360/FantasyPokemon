import type { PokemonType } from './pair'

// One entry of src/data/dst_units.json exactly as stored on disk
export interface RawDstUnit {
  team: string
  members: string[] // pair ids of the team's 12 defensive Pokémon
  dominantType: PokemonType // most common member type, ties broken alphabetically
  typeCounts: Partial<Record<PokemonType, number>>
}

// A D/ST unit after the loader joins in projections and ratings
export interface DstUnit extends RawDstUnit {
  projectedPPG: number
  maddenOvr: number // average OVR of the members, used as the draft tiebreaker
}

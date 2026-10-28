// Shapes of src/data/pairs.json (written by scripts/match_pairs.py).

export type PokemonType =
  | 'Normal'
  | 'Fighting'
  | 'Flying'
  | 'Poison'
  | 'Ground'
  | 'Rock'
  | 'Bug'
  | 'Ghost'
  | 'Steel'
  | 'Fire'
  | 'Water'
  | 'Grass'
  | 'Electric'
  | 'Psychic'
  | 'Ice'
  | 'Dragon'
  | 'Dark'
  | 'Fairy'

export type FantasyPos = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF'
export type DefGroup = 'DL' | 'LB' | 'CB' | 'S'

export interface BaseStats {
  hp: number
  atk: number
  def: number
  spa: number
  spd: number
  spe: number
}

export interface PairedNflPlayer {
  name: string
  gsisId: string // nflverse player ID; weekly stats join on this
  team: string
  depthSlot: string // nflverse depth chart slot, e.g. 'QB', 'PK', 'LCB'
  maddenOvr: number
  maddenPos: string
  productionScore: number // per-game score used for matching, not fantasy points
}

// One entry of pairs.json exactly as stored on disk
export interface RawPair {
  id: string // zero-padded dex number, e.g. '001'; the stable key
  dex: number
  pokemon: string
  gen: number
  types: [PokemonType] | [PokemonType, PokemonType]
  baseStats: BaseStats
  bst: number
  fantasyPos: FantasyPos
  defGroup: DefGroup | null // set only when fantasyPos is 'DEF'
  posRank: number // rank within fantasyPos at matching time (1 = best)
  nfl: PairedNflPlayer
}

// A pair after the loader joins in projections
export interface Pair extends RawPair {
  projectedPPG: number
}

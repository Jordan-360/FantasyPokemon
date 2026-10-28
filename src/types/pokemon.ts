export interface Pokemon {
  pokedexId: number
  formId: string
  name: string
  types: [string] | [string, string]
  hp: number
  attack: number
  defense: number
  spAttack: number
  spDefense: number
  speed: number
  height: number // decimetres (raw PokeAPI unit)
  weight: number // hectograms (raw PokeAPI unit)
}

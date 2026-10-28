export interface Mapping {
  pokedexId: number
  formId: string
  pokemon: string
  playerId: string
  player: string
  position: string
  team: string
  fitScore: number
}

// Precomputed from loaded data and passed into fitScore so the function stays pure
export interface ScoringContext {
  positionStats: Record<
    string,
    {
      meanHeight: number
      stdHeight: number
      meanWeight: number
      stdWeight: number
    }
  >
  bstRange: { min: number; max: number }
  playerRankRange: { min: number; max: number }
}

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
  // Talent score per player, normalized within each position group (not globally).
  // The best DL scores 1.0, the best QB scores 1.0 — cross-position fantasy rank
  // skew (defense scores low in fantasy, offense scores high) is eliminated.
  playerTalent: Record<string, number>
}

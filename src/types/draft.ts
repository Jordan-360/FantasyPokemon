// Draft positions: offense pairs plus D/ST units (defensive pairs aren't drafted alone)
export type DraftPos = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST'

// One thing a team can draft: an offensive pair or a team D/ST
export interface Draftable {
  id: string // pair id ('001') or 'DST-<team>'
  pos: DraftPos
  name: string // Pokémon name, or '<team> D/ST'
  nflName: string // NFL player, or team for D/ST
  team: string
  projectedPPG: number
  maddenOvr: number
}

export interface DraftSettings {
  teams: number
  rounds: number
}

export interface DraftPick {
  overall: number // 0-based pick index
  round: number // 1-based
  teamIndex: number
  playerId: string
}

// Serializable draft state. Rosters and availability are derived from picks.
export interface DraftState {
  settings: DraftSettings
  order: number[] // teamIndex for every pick, snake already applied
  picks: DraftPick[]
}

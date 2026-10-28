// Shapes of the files written by scripts/refreshWeeklyPoints.ts

export interface PointsMeta {
  generatedAt: string // ISO timestamp
  season: number
  source: string
}

// Real (pre-Pokémon-layer) fantasy points for one NFL week.
// A missing key means the player or D/ST didn't play that week (fainted / bye).
export interface WeekPoints {
  players: Record<string, number> // gsisId -> points
  dst: Record<string, number> // NFL team -> points
}

export interface WeeklyPointsFile {
  meta: PointsMeta & { weeks: number[] }
  weeks: Record<string, WeekPoints> // keyed by week number, e.g. '1'
}

export interface ProjectionsFile {
  meta: PointsMeta & { method: string }
  players: Record<string, number> // gsisId -> projected PPG
  dst: Record<string, number> // NFL team -> projected PPG
}

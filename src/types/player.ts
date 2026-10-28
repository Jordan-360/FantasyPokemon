export interface NFLPlayer {
  playerId: string
  name: string
  position: string // QB | RB | WR | TE | K | DL | LB | CB | S
  team: string
  height: number | null // inches
  weight: number | null // pounds
  age: number | null
  searchRank: number // lower = better; null source values mapped to 99999
}

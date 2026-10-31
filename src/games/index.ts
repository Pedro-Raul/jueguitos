import type { GameDefinition } from '../types'
import cucupoly from './cucupoly'

/**
 * Game registry. To add a game: create src/games/<id>/index.tsx exporting a
 * GameDefinition and add one line here. To delete one: delete its folder and
 * its line below.
 */
export const games: GameDefinition<any>[] = [cucupoly]

export function getGame(id: string | null): GameDefinition<any> | undefined {
  if (!id) return undefined
  return games.find((game) => game.id === id)
}

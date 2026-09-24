// POST /api/game/finish  { game_id, client_key, score, lines, level, pieces }
//   -> { game_id, score, lines, level }
// Records a game's final numbers once, at game over, if they are possible in
// the time since /api/game/new. Submit reads the score from here, never from
// its own request.

import { clientKey, endpoint, gameId, HttpError } from "../_lib/http.js";
import { implausible, MAX_GAME_MS, readStats } from "../_lib/rules.js";
import { rest } from "../_lib/supabase.js";

export default endpoint("POST", async ({ body }) => {
  const id = gameId(body.game_id);
  const key = clientKey(body.client_key);
  const stats = readStats(body);
  if (!stats) throw new HttpError(400, "bad_stats", "score, lines, level and pieces are whole numbers.");

  const [game] =
    (await rest(`uwutetris_games?id=eq.${id}&select=client_key,started_at,finished_at`)) ?? [];
  // Another page's game looks the same as no game at all.
  if (!game || game.client_key !== key) throw new HttpError(404, "not_found", "That game does not exist.");
  if (game.finished_at) throw new HttpError(409, "already_finished", "That game is already over.");

  const elapsed = Date.now() - Date.parse(game.started_at);
  if (elapsed > MAX_GAME_MS) throw new HttpError(410, "expired", "That game is too old to rank.");
  if (implausible(stats, elapsed)) {
    throw new HttpError(422, "implausible", "That score does not fit the game that was played.");
  }

  // Conditional on still being unfinished, so two finishes cannot both land.
  const [saved] =
    (await rest(`uwutetris_games?id=eq.${id}&finished_at=is.null`, {
      method: "PATCH",
      body: { ...stats, finished_at: new Date().toISOString() },
      prefer: "return=representation",
    })) ?? [];
  if (!saved) throw new HttpError(409, "already_finished", "That game is already over.");

  return { game_id: id, score: saved.score, lines: saved.lines, level: saved.level };
});

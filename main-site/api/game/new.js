// POST /api/game/new  { client_key } -> { game_id, started_at }
// Called when a game starts. The start time is the server's, and it is what
// finish measures the game's length against.

import { randomInt } from "node:crypto";
import { clientKey, endpoint } from "../_lib/http.js";
import { rest, rpc } from "../_lib/supabase.js";

export default endpoint("POST", async ({ body }) => {
  const key = clientKey(body.client_key);

  const [game] = await rest("uwutetris_games", {
    method: "POST",
    body: { client_key: key },
    prefer: "return=representation",
  });

  // Now and then, clear out games nobody added to the leaderboard.
  if (randomInt(50) === 0) rpc("uwutetris_prune", {}).catch((err) => console.warn("prune failed:", err.message));

  return { game_id: game.id, started_at: game.started_at };
});

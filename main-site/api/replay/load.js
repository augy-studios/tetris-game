// GET /api/replay/load?id=<id> -> { data }
// The packed game behind a short replay link. A saved replay never changes,
// so the edge keeps it for a long time.

import { endpoint, HttpError } from "../_lib/http.js";
import { replayId } from "../_lib/replays.js";
import { rest } from "../_lib/supabase.js";

export default endpoint("GET", async ({ req, res }) => {
  const id = replayId(req.query?.id);
  const [row] = (await rest(`uwutetris_replays?id=eq.${id}&select=data`)) ?? [];
  if (!row) throw new HttpError(404, "not_found", "There is no replay at that link.");
  res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=31536000, immutable");
  return { data: row.data };
});

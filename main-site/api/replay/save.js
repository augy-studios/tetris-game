// POST /api/replay/save  { data } -> { id }
// Keeps a replay link's packed game under a short id, for /?s=<id>. The id
// is the start of the data's SHA-256 in base 62, so saving the same game
// again gives the same id and no new row. Eight characters, longer only in
// the unlikely case another game already has those eight.

import { createHash } from "node:crypto";
import { endpoint, HttpError } from "../_lib/http.js";
import { replayData } from "../_lib/replays.js";
import { rest } from "../_lib/supabase.js";

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function base62(bytes) {
  let n = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (n > 0n) {
    out = DIGITS[Number(n % 62n)] + out;
    n /= 62n;
  }
  return out.padStart(16, "0");
}

export default endpoint("POST", async ({ body }) => {
  const data = replayData(body.data);
  const hash = base62(createHash("sha256").update(data).digest());

  for (let length = 8; length <= 16; length++) {
    const id = hash.slice(0, length);
    const [existing] = (await rest(`uwutetris_replays?id=eq.${id}&select=data`)) ?? [];
    if (existing) {
      if (existing.data === data) return { id };
      continue; // another game's: one character more
    }
    // Two saves of one game at once both land on the same row.
    await rest("uwutetris_replays?on_conflict=id", {
      method: "POST",
      body: { id, data },
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
    return { id };
  }
  throw new HttpError(500, "server");
});

# api

Vercel serverless functions for the leaderboards. The game itself runs in
the browser; these record finished games and rank them.

## Endpoints

All take and return JSON. Game endpoints need `client_key`: a random id the
browser keeps in local storage. A game is only visible to the key that
started it.

| Endpoint | Body | Returns |
|---|---|---|
| `POST /api/game/new` | `client_key` | `game_id, started_at` |
| `POST /api/game/finish` | `game_id, client_key, score, lines, level, pieces` | `game_id, score, lines, level` |
| `POST /api/leaderboard/submit` | `game_id, name` | `name, rank, best_score, total, games, total_rank` |
| `POST /api/leaderboard/name` | `name` | `name`, cleaned, or a `400` saying why not |
| `GET /api/leaderboard` | `?board=best` (default) or `?board=total` | `board, entries`, cached 30 s |

Errors are `{ "error": code, "message"? }` with a matching status: `400` bad
input, `404` no such game, `409` game already finished or submitted, `410`
game or submission expired, `422` a score the game could not have produced.

## Trust

The browser computes the score, so `finish` treats the numbers as a claim and
checks them in `_lib/rules.js` against the time since `new`, which only the
server knows:

- the level is exactly `1 + lines / 10`
- every cleared line needs 10 cells, and a piece brings 4
- no more than 6 pieces a second, far past human play
- the score is at most a tetris for every line plus two full hard drops a piece

A game is finished once. `submit` reads its score from the game row, never
from the request, and a game goes on the board once. This stops a forged
request; it does not stop somebody sending believable numbers.

A game started offline never gets a `game_id`, so it is played unranked.
There are no rate limits.

## Leaderboards

Two boards over the same submissions, one row per name, names compared
case-insensitively:

| Board | Entries | Ranked by |
|---|---|---|
| `best` | `{ rank, name, score, lines }` | the name's single best game; ties to whoever got it first |
| `total` | `{ rank, name, total, games }` | every submitted game added up; ties to fewer games, then whoever got there first |

A game must be submitted within an hour of finishing, with a score above 0.

## Files

| Path | What it does |
|---|---|
| `game/*.js`, `leaderboard/*.js` | The endpoints. |
| `_lib/rules.js` | Scoring limits and the plausibility checks. |
| `_lib/http.js` | Input checks and error replies. |
| `_lib/names.js` | Leaderboard name cleaning and the word filter, shared with mrtguess. |
| `_lib/supabase.js` | Supabase REST with the service role key. |

Vercel does not route files under `_lib/`. The SQL is in `/migrations`.

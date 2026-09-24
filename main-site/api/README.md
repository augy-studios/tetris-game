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
| `POST /api/game/finish` | `game_id, client_key, score, lines, level, pieces, log` | `game_id, score, lines, level` |
| `POST /api/leaderboard/submit` | `game_id, name` | `name, rank, best_score, total, games, total_rank` |
| `POST /api/leaderboard/name` | `name` | `name`, cleaned, or a `400` saying why not |
| `GET /api/leaderboard` | `?board=best` (default) or `?board=total` | `board, entries`, cached 30 s |

Errors are `{ "error": code, "message"? }` with a matching status: `400` bad
input or an out of date copy of the game (`outdated`), `404` no such game,
`409` game already finished or submitted, `410` game or submission expired,
`422` a score the game could not have produced.

## Trust

The browser computes the score, so `finish` treats the numbers as a claim.
With them comes `log`, every lock and hold of the game, and `_lib/replay.js`
plays the game again from it:

- every piece comes out of a fair 7-bag, in order
- every piece locks in empty cells, resting on something
- at most one hold per lock
- drop points per piece stay within two full hard drops
- no 20 locks in a row faster than 6 pieces a second, far past human play
- the log's play time fits in the time since `new`, which only the server knows

The replay's score, lines, level and pieces must equal the claim. `_lib/rules.js`
then checks them against the time since `new` as well. A refused game logs its
reason on the server; the reply only says `implausible`.

A game is finished once. `submit` reads its score from the game row, never
from the request, and a game goes on the board once. Forging a game means
writing something that plays it, at human speed. The replay does not check
a piece could have been steered to where it locked.

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
| `_lib/replay.js` | Replays a finished game's log; its pieces and scoring mirror `/script.js`. |
| `_lib/http.js` | Input checks and error replies. |
| `_lib/names.js` | Leaderboard name cleaning and the word filter, shared with mrtguess. |
| `_lib/supabase.js` | Supabase REST with the service role key. |

Vercel does not route files under `_lib/`. The SQL is in `/migrations`.

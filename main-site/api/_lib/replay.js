// Replays a finished game from the log script.js keeps, and works out its
// score, lines and level from that rather than taking them on trust. Each
// entry is one of
//
//   [type, r, x, y, t, points]   the piece in play locked at x, y in rotation r
//   ["H", type, t, points]        the piece in play put on hold
//
// t is ms of play since the game started; points is what soft and hard drops
// scored since the entry before.
//
// It checks every piece came out of a fair 7-bag, locked in empty cells resting
// on something, holds came at most once a lock, and no stretch of pieces came
// faster than MAX_PIECES_PER_SECOND. It does not check a piece could have been
// steered to where it locked. Forging a game means writing a player for it.
//
// The pieces, board and scoring must match script.js.

import { LINE_SCORES, levelFor, MAX_DROP_POINTS_PER_PIECE, MAX_GAME_MS, MAX_PIECES_PER_SECOND } from "./rules.js";

const COLS = 10;
const ROWS = 20;
const TYPES = ["I", "J", "L", "O", "S", "T", "Z"];

// Cells per rotation state (0, R, 2, L), with y pointing down.
const SHAPES = {
  I: [
    [[0, 1], [1, 1], [2, 1], [3, 1]],
    [[2, 0], [2, 1], [2, 2], [2, 3]],
    [[0, 2], [1, 2], [2, 2], [3, 2]],
    [[1, 0], [1, 1], [1, 2], [1, 3]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [2, 2]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [1, 2], [2, 2]],
    [[0, 1], [1, 1], [2, 1], [0, 2]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
  O: [
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
    [[1, 0], [2, 0], [1, 1], [2, 1]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[1, 0], [1, 1], [2, 1], [2, 2]],
    [[1, 1], [2, 1], [0, 2], [1, 2]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  T: [
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[1, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [2, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[2, 0], [1, 1], [2, 1], [1, 2]],
    [[0, 1], [1, 1], [1, 2], [2, 2]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
};

const MAX_ENTRIES = 100000;

// Any PACE_WINDOW locks in a row take at least this much play.
const PACE_WINDOW = 20;
const MIN_WINDOW_MS = (PACE_WINDOW / MAX_PIECES_PER_SECOND) * 1000;

// The game's clock starts a moment before the server hears about it.
const CLOCK_SLACK_MS = 10000;

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// { stats } for a game that could have happened, or { reason } why not.
export function replay(log, elapsedMs) {
  const fail = (reason) => ({ reason });
  if (!Array.isArray(log) || log.length > MAX_ENTRIES) return fail("log");

  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const drawn = [];
  const lockedAt = [];
  let cur = null; // null: the next entry's piece came out of the bag
  let hold = null;
  let canHold = true;
  let ended = false;
  let score = 0;
  let lines = 0;
  let level = 1;
  let lastT = 0;

  for (const entry of log) {
    if (ended || !Array.isArray(entry)) return fail("log");
    const held = entry[0] === "H";
    if (entry.length !== (held ? 4 : 6)) return fail("log");
    const [type, r, x, y, t, points] = held ? [entry[1], 0, 0, 0, entry[2], entry[3]] : entry;
    if (!TYPES.includes(type) || !isInt(t, 0, MAX_GAME_MS) || !isInt(points, 0, MAX_DROP_POINTS_PER_PIECE)) {
      return fail("log");
    }
    if (t < lastT) return fail("clock");
    lastT = t;

    if (cur === null) {
      // No piece twice in one bag of seven.
      if (drawn.slice(drawn.length - (drawn.length % 7)).includes(type)) return fail("bag");
      drawn.push(type);
      cur = type;
    }
    if (cur !== type) return fail("order");
    score += points;

    if (held) {
      if (!canHold) return fail("hold");
      canHold = false;
      [cur, hold] = [hold, type];
      continue;
    }

    if (!isInt(r, 0, 3) || !isInt(x, -3, COLS) || !isInt(y, -3, ROWS)) return fail("log");
    const cells = SHAPES[type][r].map(([dx, dy]) => [x + dx, y + dy]);
    const blocked = (down) =>
      cells.some(([cx, cy]) => cx < 0 || cx >= COLS || cy + down >= ROWS || (cy + down >= 0 && board[cy + down][cx]));
    if (blocked(0) || !blocked(1)) return fail("placement");

    lockedAt.push(t);
    const n = lockedAt.length;
    if (n > PACE_WINDOW && t - lockedAt[n - 1 - PACE_WINDOW] < MIN_WINDOW_MS) return fail("pace");
    cur = null;
    canHold = true;

    // Locked out: part of the piece is above the board, and the game ends.
    if (cells.some(([, cy]) => cy < 0)) {
      ended = true;
      continue;
    }
    for (const [cx, cy] of cells) board[cy][cx] = true;

    let cleared = 0;
    for (let row = ROWS - 1; row >= 0; row--) {
      if (board[row].every(Boolean)) {
        board.splice(row, 1);
        cleared++;
      }
    }
    for (let i = 0; i < cleared; i++) board.unshift(Array(COLS).fill(false));
    lines += cleared;
    score += LINE_SCORES[cleared] * level;
    level = levelFor(lines);
  }

  if (lastT > elapsedMs + CLOCK_SLACK_MS) return fail("clock");
  return { stats: { score, lines, level, pieces: lockedAt.length } };
}

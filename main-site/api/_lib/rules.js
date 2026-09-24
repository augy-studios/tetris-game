// Score plausibility. The game runs in the browser, so a finished game's
// numbers are a claim, not a record. replay.js recomputes them from the game's
// log; these checks then refuse any the game could never produce in the time
// the server saw it being played.
//
// Scoring must match script.js: LINE_SCORES times the level before the clear,
// 1 a row for a soft drop, 2 a row for a hard drop, level 1 + lines / 10.

export const LINE_SCORES = [0, 100, 300, 500, 800];

// Well past the fastest human play, so nobody real is refused.
export const MAX_PIECES_PER_SECOND = 6;
const PIECE_SLACK = 10;

// A piece falls at most 21 rows from its spawn. A hold can send a soft
// dropped piece back to the top once per lock, so allow two full descents at
// the hard drop rate.
export const MAX_DROP_POINTS_PER_PIECE = 2 * 2 * 21;

// A game can sit paused for a long time; one left longer than this is gone.
export const MAX_GAME_MS = 12 * 60 * 60 * 1000;

const CAPS = { score: 1e9, lines: 1e5, level: 1e4, pieces: 1e6 };

export const levelFor = (lines) => 1 + Math.floor(lines / 10);

// A tetris is 800 for four lines, the most any line can earn at a level.
function maxLinePoints(lines) {
  let total = 0;
  for (let i = 0; i < lines; i++) total += (LINE_SCORES[4] / 4) * levelFor(i);
  return total;
}

// The numbers as sent, checked for shape, or null if any is not a whole
// number in range.
export function readStats(body) {
  const stats = {};
  for (const [field, cap] of Object.entries(CAPS)) {
    const value = body[field];
    if (!Number.isInteger(value) || value < 0 || value > cap) return null;
    stats[field] = value;
  }
  return stats;
}

// Why the numbers cannot be real, or null when they could be.
export function implausible({ score, lines, level, pieces }, elapsedMs) {
  if (level !== levelFor(lines)) return "level";
  // Every cleared line is 10 cells and every piece brings 4.
  if (lines * 10 > pieces * 4) return "lines";
  if (pieces > (elapsedMs / 1000) * MAX_PIECES_PER_SECOND + PIECE_SLACK) return "pieces";
  if (score > maxLinePoints(lines) + pieces * MAX_DROP_POINTS_PER_PIECE) return "score";
  return null;
}

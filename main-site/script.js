// Tetris Game. A classic script rather than a module: it needs nothing but
// the DOM, and reads every colour it draws from the theme tokens in
// style.css, so the board follows light, dark and time-based mode.
(() => {
  "use strict";

  const COLS = 10;
  const ROWS = 20;
  const NEXT_COUNT = 5;
  const MINI_COLS = 4;
  const MINI_ROWS = 2;

  const DAS = 170; // ms a held left or right waits before repeating
  const ARR = 50; // ms between those repeats
  const SOFT_DROP_EVERY = 50;
  const LOCK_DELAY = 500; // ms a landed piece can still slide before it locks
  const MAX_LOCK_RESETS = 15; // moves that can restart that wait, per row

  const TYPES = ["I", "J", "L", "O", "S", "T", "Z"];
  const LINE_SCORES = [0, 100, 300, 500, 800];
  // Garbage rows a clear sends the other board in a match, by lines cleared.
  const ATTACK = [0, 0, 1, 2, 4];

  // Crockford's base 32: no I, L, O or U to misread when a seed is copied by hand.
  const SEED_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const SEED_LENGTH = 8;

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

  // SRS wall kicks, written as published: y points UP. rotate() flips it.
  const KICKS = {
    JLSTZ: {
      "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
      "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
      "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
      "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
      "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    },
    I: {
      "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
      "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
      "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
      "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
      "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    },
  };

  const $ = (id) => document.getElementById(id);
  const game = document.querySelector(".game");
  const wrap = $("boardWrap");
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const holdCanvas = $("hold");
  const nextList = $("next");
  const nextCanvases = [...nextList.querySelectorAll("canvas")];
  const oppCanvas = $("oppBoard");
  const pauseBtn = document.querySelector('.pad-btn[data-act="pause"]');
  const stats = { score: $("score"), level: $("level"), lines: $("lines") };
  const overlay = {
    root: $("boardOverlay"),
    title: $("overlayTitle"),
    sub: $("overlaySub"),
    hint: $("overlayHint"),
    touchHint: $("overlayTouchHint"),
    primary: $("overlayPrimary"),
    secondary: $("overlaySecondary"),
    seedForm: $("seedForm"),
    seedInput: $("seedInput"),
    seedCopy: $("seedCopy"),
  };

  // Board cells hold a piece type, not a colour, so a theme change recolours
  // pieces that have already landed. "G" is garbage from the other board.
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(""));

  let tile = 0;
  let dpr = 0;
  let palette = null;
  let dirty = true;

  let seed = ""; // this game's; the same seed always deals the same pieces
  let chosenSeed = false; // pasted in by the player rather than dealt at random
  let deal = null; // the next piece out of this game's bags
  let queue = [];
  let cur = null;
  let hold = null;
  let canHold = true;
  let score = 0;
  let lines = 0;
  let level = 1;
  let pieces = 0; // locked this game; the leaderboard checks the score against it
  // Every lock and hold this game, and in a match every load of garbage. The
  // leaderboard replays it to check the score (api/_lib/replay.js has the
  // format), and so does the replay here.
  let log = [];
  // Per log entry, the moves of the piece it ended as [t, x, y, r], for the
  // replay to show each one falling as it did; null for garbage. Not sent
  // anywhere: a shared replay works its moves out again.
  let trails = [];
  let trail = []; // the piece in play's, so far
  let gameStart = 0; // the clock when this game began
  let dropPoints = 0; // scored by drops since the last log entry
  let dropInterval = 1000;
  let paused = false;
  let over = false;

  // Milliseconds of actual play. Gravity and the lock delay run on this, so a
  // pause, a hidden tab or the theme modal never makes a piece jump on return.
  let clock = 0;
  let lastFrame = null;
  let lastDrop = 0;
  let landedAt = null;
  let lockResets = 0;
  let lowestY = 0;
  let suspended = false;

  /* -- Seeds -- */

  function randomSeed() {
    return Array.from(crypto.getRandomValues(new Uint8Array(SEED_LENGTH)), (b) => SEED_CHARS[b & 31]).join("");
  }

  // Any text is a seed. Case and spaces are dropped, so a seed read aloud or
  // pasted with a stray space still deals the same game.
  function cleanSeed(text) {
    return text.replace(/\s+/g, "").toUpperCase().slice(0, 32);
  }

  // FNV-1a, to turn the seed's text into mulberry32's 32-bit state.
  function hashSeed(text) {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // mulberry32: a small, fast generator, plenty for shuffling seven pieces.
  function seededRandom(text) {
    let a = hashSeed(text);
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* -- Pieces -- */

  // 7-bag: every piece once per seven, in a fair Fisher-Yates order. The same
  // seed always deals the same pieces, which is what lets a replay deal them again.
  function dealer(text) {
    const random = seededRandom(text);
    let bag = [];
    return () => {
      if (!bag.length) {
        bag = [...TYPES];
        for (let i = bag.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [bag[i], bag[j]] = [bag[j], bag[i]];
        }
      }
      return bag.pop();
    };
  }

  // Leaves exactly NEXT_COUNT behind for the preview.
  function takeNext() {
    while (queue.length <= NEXT_COUNT) queue.push(deal());
    return queue.shift();
  }

  function cellsOf(p) {
    return SHAPES[p.type][p.r].map(([dx, dy]) => [p.x + dx, p.y + dy]);
  }

  // The cells a piece covers, as one value, so two rotation states that
  // cover the same cells (S, Z and I have them) compare equal.
  function cellsKey(p) {
    return cellsOf(p)
      .map(([x, y]) => (y + 8) * 16 + x + 4)
      .sort((a, b) => a - b)
      .join();
  }

  // Rows above the board (y < 0) are open space, but the walls and floor are
  // not. grid is the board, or a replay's.
  function collides(p, grid = board) {
    return cellsOf(p).some(
      ([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && grid[y][x] !== "")
    );
  }

  function grounded() {
    return collides({ ...cur, y: cur.y + 1 });
  }

  // Just above the board, then straight into view when there is room, as the
  // guideline does.
  function spawnAt(type, grid = board) {
    const p = { type, r: 0, x: 3, y: -1 };
    if (!collides(p, grid) && !collides({ ...p, y: 0 }, grid)) p.y = 0;
    return p;
  }

  function spawn(type) {
    cur = spawnAt(type);
    landedAt = null;
    lockResets = 0;
    lastDrop = clock;
    autoTarget = null;
    dirty = true;
    traced();
    drawMinis();

    if (collides(cur)) {
      endGame(); // blocked out: no room for the new piece
      return;
    }
    lowestY = cur.y;
  }

  // Where the piece in play is now, added to its trail. Moves within one
  // millisecond keep only the last, so a hard drop is one jump.
  function traced() {
    const point = [Math.round(clock - gameStart), cur.x, cur.y, cur.r];
    if (trail.length && trail[trail.length - 1][0] === point[0]) trail[trail.length - 1] = point;
    else trail.push(point);
  }

  function record(entry) {
    log.push([...entry, Math.round(clock - gameStart), dropPoints]);
    dropPoints = 0;
    if (entry[0] === "G") {
      trails.push(null); // garbage moves no piece
      return;
    }
    trails.push(trail);
    trail = [];
  }

  function lock() {
    record([cur.type, cur.r, cur.x, cur.y]);
    pieces++;
    let above = false;
    for (const [x, y] of cellsOf(cur)) {
      if (y < 0) above = true;
      else board[y][x] = cur.type;
    }
    dirty = true;

    if (above) {
      endGame(); // locked out: part of the piece never made it onto the board
      return;
    }

    const cleared = clearLines();
    if (match && exchangeGarbage(cleared)) {
      endGame(); // topped out: garbage pushed the stack off the top
      return;
    }
    canHold = true;
    spawn(takeNext());
    updateStats();
  }

  // Takes the full rows out of grid, the board or a replay's. cleared is how
  // many; scored, how many had no garbage in them. Garbage scores nothing,
  // since the leaderboard cannot tell real garbage from made-up garbage
  // (api/_lib/replay.js), but a garbage row cleared still counts as attack.
  function removeFullRows(grid) {
    let cleared = 0;
    let scored = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (grid[y].every((c) => c !== "")) {
        if (!grid[y].includes("G")) scored++;
        grid.splice(y, 1);
        grid.unshift(Array(COLS).fill(""));
        cleared++;
        y++;
      }
    }
    return { cleared, scored };
  }

  // Pushes rows of garbage in from the bottom of grid, each with a gap at
  // hole. True when that pushes anything off the top.
  function addGarbage(grid, rows, hole) {
    const lost = grid.slice(0, rows).some((row) => row.some((c) => c !== ""));
    grid.splice(0, rows);
    for (let i = 0; i < rows; i++) grid.push(Array.from({ length: COLS }, (_, x) => (x === hole ? "" : "G")));
    return lost;
  }

  const levelFor = (lines) => 1 + Math.floor(lines / 10);

  function clearLines() {
    const { cleared, scored } = removeFullRows(board);
    if (!cleared) return 0;

    lines += scored;
    score += LINE_SCORES[scored] * level;
    level = levelFor(lines);
    dropInterval = Math.max(80, 1000 - (level - 1) * 60);
    return cleared;
  }

  /* -- Moves -- */

  function playing() {
    return cur !== null && !paused && !over && !suspended && !countdownEnd;
  }

  function tryMove(dx, dy) {
    const moved = { ...cur, x: cur.x + dx, y: cur.y + dy };
    if (collides(moved)) return false;
    cur = moved;
    dirty = true;
    traced();
    return true;
  }

  // A move or rotation on the ground restarts the lock delay, a limited
  // number of times per row, so a piece cannot be spun forever.
  function afterMove() {
    if (cur.y > lowestY) {
      lowestY = cur.y;
      lockResets = 0;
    }
    if (landedAt !== null && lockResets < MAX_LOCK_RESETS) {
      landedAt = clock;
      lockResets++;
    }
  }

  function move(dx) {
    if (playing() && tryMove(dx, 0)) afterMove();
  }

  // The piece turned with the SRS kicks, or null when every kick is blocked.
  function rotated(p, dir, grid = board) {
    const to = (p.r + (dir > 0 ? 1 : 3)) % 4;
    const kicks = (p.type === "I" ? KICKS.I : KICKS.JLSTZ)[`${p.r}>${to}`];
    for (const [kx, ky] of kicks) {
      // The kick tables have y pointing up; the board's y points down.
      const test = { ...p, r: to, x: p.x + kx, y: p.y - ky };
      if (!collides(test, grid)) return test;
    }
    return null;
  }

  function rotate(dir) {
    if (!playing() || cur.type === "O") return;
    const next = rotated(cur, dir);
    if (!next) return;
    cur = next;
    dirty = true;
    traced();
    afterMove();
  }

  function softDrop() {
    if (!playing() || !tryMove(0, 1)) return;
    score += 1;
    dropPoints += 1;
    lastDrop = clock;
    afterMove();
    updateStats();
  }

  function hardDrop() {
    if (!playing()) return;
    let distance = 0;
    while (tryMove(0, 1)) distance++;
    score += distance * 2;
    dropPoints += distance * 2;
    lock();
    updateStats();
  }

  function holdPiece() {
    if (!playing() || !canHold) return;
    record(["H", cur.type]);
    const incoming = hold ?? takeNext();
    hold = cur.type;
    spawn(incoming);
    canHold = false;
    drawMinis();
  }

  // Gravity is not a soft drop, so it scores nothing.
  function step() {
    if (grounded()) {
      if (landedAt === null) landedAt = clock;
      if (clock - landedAt >= LOCK_DELAY) lock();
      return;
    }
    landedAt = null;
    if (clock - lastDrop >= dropInterval) {
      tryMove(0, 1);
      lastDrop = clock;
      if (cur.y > lowestY) {
        lowestY = cur.y;
        lockResets = 0;
      }
    }
  }

  /* -- Game state -- */

  // js/ranked.js listens for these to rank the game. It is a module, so it
  // loads after this script has started the first game; holding events until
  // DOMContentLoaded means it still hears that one.
  function announce(name, detail) {
    const send = () => document.dispatchEvent(new CustomEvent(name, { detail }));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", send, { once: true });
    else send();
  }

  // A new game, dealt from the seed given or from a fresh random one. In a
  // match, matchId is the match's and the seed is the host's.
  function reset(chosen = "", matchId = 0) {
    chosenSeed = chosen !== "";
    seed = chosenSeed ? chosen : randomSeed();
    deal = dealer(seed);
    closeReplay(false);
    forgetShared();
    board.forEach((row) => row.fill(""));
    queue = [];
    hold = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    pieces = 0;
    log = []; // a new array: the last game's is still on its way to the server
    trails = [];
    trail = [];
    oppTrail = []; // new, like log: an open replay may still hold the last
    gameStart = clock;
    dropPoints = 0;
    dropInterval = 1000;
    paused = false;
    over = false;
    autoplay = false;
    assisted = false;
    countdownEnd = 0;
    match = matchId ? { id: matchId, result: null, why: "" } : null;
    incoming = 0;
    received = 0;
    sent = 0;
    garbageHoles = seededRandom(`${seed}/garbage`);
    releaseAll();
    hideOverlay();
    // A match's seed is the host's, picked at random like any game's, not
    // one pasted in to practise, so a match ranks.
    announce("tetris:start", { seeded: chosenSeed && !match, versus: Boolean(match) });
    spawn(takeNext());
    updateStats();
    syncPauseButton();
  }

  // R, Play again and Restart. With another device, the next match instead,
  // which js/versus.js starts; a match under way cannot be walked out of.
  function newGame() {
    if (versus) {
      if (match && !over) return;
      document.dispatchEvent(new CustomEvent("tetris:rematch"));
      return;
    }
    reset();
  }

  function endGame() {
    over = true;
    paused = false;
    autoplay = false;
    countdownEnd = 0;
    releaseAll();
    dirty = true;
    updateStats();
    showOverlay("over");
    syncPauseButton();
    announce("tetris:over", {
      score,
      lines,
      level,
      pieces,
      log,
      assisted,
      versus: Boolean(match),
      match: match?.id ?? 0,
    });
  }

  // A match never pauses: the other board would carry on regardless.
  function setPaused(value) {
    if (over || cur === null || countdownEnd || paused === value) return;
    if (match && value) return;
    paused = value;
    releaseAll();
    if (paused) showOverlay("paused");
    else hideOverlay();
    syncPauseButton();
  }

  let overlayKind = null; // what the overlay is showing, or null when hidden
  let shownSeed = ""; // the seed in the overlay's field

  // What each screen over the board says and offers. Buttons are
  // [label, action]; seed is the seed to show, when there is one.
  function overlayFor(kind) {
    const scoreLine = `Score ${score.toLocaleString()}`;
    switch (kind) {
      case "over":
        return {
          title: !match?.result
            ? "Game over"
            : match.result === "won"
              ? "You won"
              : match.result === "lost"
                ? "You lost"
                : "Match over",
          sub: match?.why ? `${scoreLine}. ${match.why}` : scoreLine,
          primary: [versus ? "Rematch" : "Play again", "reset"],
          secondary: log.length ? ["Watch replay", "replay"] : null,
          seed: versus ? null : seed,
          hint: versus ? "Or press R for a rematch." : "Or press R.",
        };
      case "countdown":
        return { title: "3", sub: "Get ready" };
      case "loading":
        return { title: "Loading replay" };
      case "shared":
        return {
          title: "Shared replay",
          sub: sharedLine(),
          primary: ["New game", "reset"],
          secondary: ["Watch again", "replay"],
          seed: watching.seed,
          hint: "Or press R for a new game.",
        };
      case "damaged":
        return {
          title: "Replay link broken",
          sub: "That replay link is damaged or incomplete, so it cannot be played back.",
          primary: ["New game", "reset"],
          hint: "Or press R.",
        };
      default:
        return {
          title: "Paused",
          primary: ["Resume", "resume"],
          // A match keeps going on the other device; restarting would leave it.
          secondary: match ? null : ["Restart", "reset"],
          seed: versus ? null : seed,
          hint: "Press P to resume.",
          touch: true,
        };
    }
  }

  function showOverlay(kind) {
    const o = overlayFor(kind);
    overlayKind = kind;
    overlay.title.textContent = o.title;
    overlay.sub.textContent = o.sub ?? "";
    overlay.sub.hidden = !o.sub;
    for (const [btn, spec] of [
      [overlay.primary, o.primary],
      [overlay.secondary, o.secondary],
    ]) {
      btn.hidden = !spec;
      if (spec) {
        btn.textContent = spec[0];
        btn.dataset.gameAct = spec[1];
      }
    }
    shownSeed = o.seed ?? "";
    overlay.seedForm.hidden = !o.seed;
    overlay.seedInput.value = shownSeed;
    overlay.seedCopy.textContent = "Copy";
    overlay.hint.textContent = o.hint ?? "";
    overlay.hint.hidden = !o.hint;
    overlay.touchHint.hidden = !o.touch;
    overlay.root.classList.remove("hidden");
  }

  function hideOverlay() {
    overlayKind = null;
    // A field left focused under the hidden overlay would swallow the game's keys.
    if (overlay.root.contains(document.activeElement)) document.activeElement.blur();
    overlay.root.classList.add("hidden");
  }

  // Copies the clipboard's way, or by the older copy command from a field
  // made for it. True when it went.
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      field.remove();
      return copied;
    }
  }

  // Copies the seed on show, whatever has been typed over it since.
  async function copySeed() {
    const input = overlay.seedInput;
    input.value = shownSeed;
    const copied = await copyText(shownSeed);
    overlay.seedCopy.textContent = copied ? "Copied" : "Copy";
    if (!copied) input.select();
  }

  overlay.seedCopy.addEventListener("click", copySeed);

  overlay.seedForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const chosen = cleanSeed(overlay.seedInput.value);
    if (!chosen) {
      overlay.seedInput.focus();
      return;
    }
    if (!versus) reset(chosen);
  });

  // The game's numbers, or the replay's for the piece on screen.
  function updateStats() {
    const v = replay ? replay.frames[replay.i] : { score, level, lines };
    stats.score.textContent = v.score.toLocaleString();
    stats.level.textContent = String(v.level);
    stats.lines.textContent = String(v.lines);
  }

  function syncPauseButton() {
    if (!pauseBtn) return;
    pauseBtn.setAttribute("aria-pressed", String(paused));
    pauseBtn.disabled = Boolean(match && !over); // no pausing a match
  }

  /* -- Autoplay --
     F2, or a triple tap on the name in the top bar, both left out of the
     controls list on purpose. Scores every spot the piece can reach with
     Pierre Dellacherie's features (weights from El-Tetris), also trying the
     hold piece, then walks the piece there one move at a time, a move a
     frame, faster than any hand. A game it ran in is not
     ranked; the next game starts clean. */

  const AUTO_STEP = 16; // ms of play between its moves: about one a frame
  const AUTO_WEIGHTS = {
    height: -4.500158825082766,
    cleared: 3.4181268101392694,
    rowTransitions: -3.2178882868487753,
    colTransitions: -9.348695305445199,
    holes: -7.899265427351652,
    wells: -3.3855972247263626,
  };
  // Turns tried before sliding: none, right, twice right, left.
  const AUTO_TURNS = [[], [1], [1, 1], [-1]];

  let autoplay = false;
  let assisted = false; // autoplay has run at some point this game
  let autoTarget = null; // { turns, x } for the piece in play
  let autoAt = 0;

  function toggleAutoplay() {
    if (over || cur === null) {
      newGame();
      if (versus) return;
    }
    autoplay = !autoplay;
    if (!autoplay) return;
    assisted = true;
    autoTarget = null;
    autoAt = clock;
    releaseAll();
    setPaused(false);
  }

  // How good grid looks with p locked where it is, by weights w. Higher is
  // better.
  function evaluate(p, grid = board, w = AUTO_WEIGHTS) {
    const cells = cellsOf(p);
    if (cells.some(([, y]) => y < 0)) return -Infinity; // would lock out
    const filled = grid.map((row) => row.map((c) => c !== ""));
    for (const [x, y] of cells) filled[y][x] = true;

    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (filled[y].every(Boolean)) {
        filled.splice(y, 1);
        cleared++;
      }
    }
    for (let i = 0; i < cleared; i++) filled.unshift(Array(COLS).fill(false));

    const ys = cells.map(([, y]) => y);
    const height = ROWS - (Math.min(...ys) + Math.max(...ys) + 1) / 2;

    // Walls and floor count as filled; the sky above does not.
    let rowTransitions = 0;
    for (let y = 0; y < ROWS; y++) {
      let prev = true;
      for (let x = 0; x < COLS; x++) {
        if (filled[y][x] !== prev) rowTransitions++;
        prev = filled[y][x];
      }
      if (!prev) rowTransitions++;
    }

    let colTransitions = 0;
    let holes = 0;
    let wells = 0;
    for (let x = 0; x < COLS; x++) {
      let prev = false;
      let covered = false;
      let depth = 0;
      for (let y = 0; y < ROWS; y++) {
        const here = filled[y][x];
        if (here !== prev) colTransitions++;
        prev = here;
        if (here) covered = true;
        else if (covered) holes++;

        const walled = (x === 0 || filled[y][x - 1]) && (x === COLS - 1 || filled[y][x + 1]);
        if (!here && walled) wells += ++depth;
        else depth = 0;
      }
      if (!prev) colTransitions++;
    }

    return (
      w.height * height +
      w.cleared * cleared +
      w.rowTransitions * rowTransitions +
      w.colTransitions * colTransitions +
      w.holes * holes +
      w.wells * wells
    );
  }

  // The best spot reachable by turning in place, sliding, then dropping.
  function bestPlacement(start) {
    let best = null;
    for (const turns of start.type === "O" ? [[]] : AUTO_TURNS) {
      let p = start;
      for (const dir of turns) p = p && rotated(p, dir);
      if (!p || collides(p)) continue;

      const xs = [p.x];
      for (let x = p.x - 1; !collides({ ...p, x }); x--) xs.push(x);
      for (let x = p.x + 1; !collides({ ...p, x }); x++) xs.push(x);

      for (const x of xs) {
        const q = { ...p, x };
        while (!collides({ ...q, y: q.y + 1 })) q.y++;
        const score = evaluate(q);
        if (!best || score > best.score) best = { turns, x, score };
      }
    }
    return best;
  }

  // One move toward the chosen spot. Anything in the way (gravity can move
  // the piece between moves) means choosing again from where it is.
  function autoStep() {
    if (!autoTarget) {
      const here = bestPlacement(cur);
      const other = canHold ? hold ?? queue[0] : null;
      const there = other && other !== cur.type ? bestPlacement(spawnAt(other)) : null;
      if (there && (!here || there.score > here.score)) {
        holdPiece();
        return;
      }
      if (!here) {
        hardDrop();
        return;
      }
      autoTarget = { turns: [...here.turns], x: here.x };
    }

    const { r, x } = cur;
    if (autoTarget.turns.length) {
      rotate(autoTarget.turns.shift());
      if (cur.r === r) autoTarget = null;
    } else if (x !== autoTarget.x) {
      move(Math.sign(autoTarget.x - x));
      if (cur.x === x) autoTarget = null;
    } else {
      hardDrop();
    }
  }

  /* -- Versus --
     js/versus.js pairs this device with another on the same network and
     drives these through window.uwuTetris. Each device plays its own board
     from the host's seed. Lines cleared send garbage to the other board,
     first cancelling any on its way here, and the first board to top out
     loses. Each board's game is ranked on its own like any other; rows with
     garbage in them score nothing (removeFullRows), so the leaderboard can
     check a match's log without knowing the other board. */

  let versus = false; // with another device, from the first match until leaving
  let match = null; // { id, result, why } for a match game; null alone
  let countdownEnd = 0; // performance.now() a match's countdown ends; 0 when none
  let incoming = 0; // garbage rows on the way, landing with the next lock that clears nothing
  let received = 0; // of the other board's running total, the rows counted into incoming
  let sent = 0; // rows sent to the other board this match, a running total
  let garbageHoles = null; // where each load's gap goes: the seed's, so a replay agrees
  let opponent = null; // the other board, as it last arrived
  let oppTrail = []; // this match's other board over time: { t, view }

  // A cleared line first cancels garbage on its way here, then goes to the
  // other board. A lock that clears nothing takes all that is waiting, and
  // true means it pushed the stack off the top.
  function exchangeGarbage(cleared) {
    if (cleared) {
      const attack = ATTACK[cleared];
      const cancel = Math.min(incoming, attack);
      incoming -= cancel;
      sent += attack - cancel;
      return false;
    }
    if (!incoming) return false;
    const rows = Math.min(incoming, ROWS);
    const hole = Math.floor(garbageHoles() * COLS);
    incoming = 0;
    record(["G", rows, hole]);
    return addGarbage(board, rows, hole);
  }

  // Both devices start the match's game at once, after the countdown.
  function startMatch(id, matchSeed, delay) {
    versus = true;
    reset(matchSeed, id);
    if (delay > 0) {
      countdownEnd = performance.now() + delay;
      showOverlay("countdown");
    }
  }

  // The host's call: "won", "lost" or "none". A board still in play stops
  // there, so the winner's game ends too.
  function setMatchResult(result, why) {
    if (!match || match.result) return;
    match.result = result;
    match.why = why;
    if (!over) endGame();
    else if (overlayKind === "over") showOverlay("over");
    if (replay?.source?.match === match) prepareLink(replay);
  }

  // Leaving the other device. A match still being played ends there, and
  // the next game is a game alone.
  function endVersus() {
    versus = false;
    if (match && !over) setMatchResult("none", "You left the match.");
    else if (overlayKind === "over") showOverlay("over");
    setOpponent(null);
  }

  // This board as the other device draws it.
  function snapshot() {
    return {
      match: match?.id ?? 0,
      cells: board.map((row) => row.map((c) => c || ".").join("")).join(""),
      cur: cur && !over ? [cur.type, cur.r, cur.x, cur.y] : null,
      score,
      lines,
      sent,
      over,
    };
  }

  // The other board's running total of garbage sent; what is new is on its way.
  function setOpponentSent(total) {
    if (!match || over || total <= received) return;
    incoming += total - received;
    received = total;
    dirty = true;
  }

  // Kept on this game's clock while the match is played, so the replay can
  // show the other board as it stood at each moment, beside this one.
  function setOpponent(view) {
    opponent = view;
    if (view && match && !over && view.match === match.id) {
      const t = Math.round(clock - gameStart);
      const last = oppTrail[oppTrail.length - 1];
      const same =
        last &&
        last.view.cells === view.cells &&
        String(last.view.cur) === String(view.cur) &&
        last.view.score === view.score;
      if (last && last.t === t) last.view = view;
      else if (!same) oppTrail.push({ t, view });
    }
    if (!replay?.opp) drawOpponent();
  }

  // The other board at time t of a replay: the last that had arrived by then.
  function opponentAt(trail, t) {
    let lo = 0;
    let hi = trail.length - 1;
    if (hi < 0 || trail[0].t > t) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (trail[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /* -- Replay --
     A finished game played back on the board: every piece falling, turning
     and sliding as it did, at the pace it was played, or half, twice or four
     times that. It plays, pauses and scrubs like a video, and steps a piece
     at a time, landing on each where it locked, ringed, to look at. The seed
     deals the same pieces again, so hold and next show what the player saw.
     It opens by itself when a game ends unless Settings says not to
     (js/app.js), and Share makes a link to it (Replay links, below). */

  // The same speeds as the word rain game's replay. The one picked last is
  // remembered in this browser.
  const REPLAY_SPEEDS = [0.5, 1, 2, 4];
  const SPEED_KEY = "uwutetris.replaySpeed";

  const replayUI = {
    seek: $("replaySeek"),
    time: $("replayTime"),
    pos: $("replayPos"),
    play: $("replayPlay"),
    speed: $("replaySpeed"),
    share: $("replayShare"),
  };

  // While a replay is open: { frames, total, i, t, playing, link, source }.
  // i is the frame on screen and t the game's time in ms.
  let replay = null;
  let replaySpeed = 1;
  let shareNote = ""; // "Link copied" and the like, for a moment, in place of the position
  let shareNoteTimer = 0;

  // The game a log describes, an entry at a time: what dealing, holding,
  // locking and garbage did. Must deal, hold, lock and score as the game does.
  class Sim {
    constructor(text) {
      this.deal = dealer(text);
      this.upcoming = [];
      this.grid = Array.from({ length: ROWS }, () => Array(COLS).fill(""));
      this.hold = null;
      this.canHold = true;
      this.score = 0;
      this.lines = 0;
      this.level = 1;
      this.over = false;
      this.cur = this.take();
    }

    take() {
      while (this.upcoming.length <= NEXT_COUNT) this.upcoming.push(this.deal());
      return this.upcoming.shift();
    }

    // What the side column and the board showed.
    view() {
      return {
        board: this.grid.map((row) => [...row]),
        hold: this.hold,
        canHold: this.canHold,
        next: this.upcoming.slice(0, NEXT_COUNT),
        score: this.score,
        lines: this.lines,
        level: this.level,
      };
    }

    // One entry without its time: [type, r, x, y], ["H", type] or
    // ["G", rows, hole], and the drop points that came with it.
    apply(entry, points) {
      this.score += points;
      if (entry[0] === "H") {
        const incoming = this.hold ?? this.take();
        this.hold = this.cur;
        this.cur = incoming;
        this.canHold = false;
        return;
      }
      if (entry[0] === "G") {
        if (addGarbage(this.grid, entry[1], entry[2])) this.over = true;
        return;
      }
      const [type, r, x, y] = entry;
      let above = false;
      for (const [cx, cy] of cellsOf({ type, r, x, y })) {
        if (cy < 0) above = true;
        else this.grid[cy][cx] = type;
      }
      this.canHold = true;
      if (above) {
        this.over = true;
        return;
      }
      const { scored } = removeFullRows(this.grid);
      this.lines += scored;
      this.score += LINE_SCORES[scored] * this.level;
      this.level = levelFor(this.lines);
      this.cur = this.take();
    }
  }

  // One frame per piece in play, the game as it stood when that piece came
  // out, then one for the end. paths are the trails the game kept, or null
  // for a shared game, whose pieces' moves are worked out when shown.
  function replayFrames(entries, text, paths) {
    const sim = new Sim(text);
    const frames = [];
    let start = 0;
    let piece = 0; // pieces locked, counting this frame's
    entries.forEach((entry, k) => {
      const [t, points] = entry.slice(-2);
      const move = entry.slice(0, -2);
      if (move[0] !== "G") {
        const held = move[0] === "H";
        if (!held) piece++;
        frames.push({
          ...sim.view(),
          type: sim.cur,
          start,
          end: Math.max(start, t),
          place: held ? null : { type: move[0], r: move[1], x: move[2], y: move[3] },
          held,
          piece,
          path: paths?.[k]?.length ? paths[k] : null,
        });
      }
      sim.apply(move, points);
      start = Math.max(start, t);
    });
    frames.push({ ...sim.view(), type: null, start, end: start, place: null, held: false, piece, path: [] });
    return frames;
  }

  // A shared game keeps where each piece locked, not how it got there. The
  // fewest moves from where it came out to there, spread over the time it
  // was in play, so it still turns, slides and falls into place.
  function synthPath(f) {
    const grid = f.board;
    const from = spawnAt(f.type, grid);
    const goal = cellsKey(f.place);
    const key = (p) => `${p.x},${p.y},${p.r}`;
    const parent = new Map([[key(from), null]]);
    const queue = [from];
    let found = null;
    for (let q = 0; q < queue.length; q++) {
      const p = queue[q];
      if (cellsKey(p) === goal) {
        found = p;
        break;
      }
      const options = [
        f.type === "O" ? null : rotated(p, 1, grid),
        f.type === "O" ? null : rotated(p, -1, grid),
        { ...p, x: p.x - 1 },
        { ...p, x: p.x + 1 },
        { ...p, y: p.y + 1 },
      ];
      for (const n of options) {
        if (!n || collides(n, grid) || parent.has(key(n))) continue;
        parent.set(key(n), p);
        queue.push(n);
      }
    }

    // Out of reach, which a hand-edited link could ask for: it appears there.
    const route = found ? [] : [f.place, from];
    for (let p = found; p; p = parent.get(key(p))) route.push(p);
    route.reverse();
    const span = f.end - f.start;
    return route.map((p, j) => [f.start + (span * j) / route.length, p.x, p.y, p.r]);
  }

  // The piece in play at time t in frame f, or null for the end.
  function replayPiece(f, t) {
    if (!f.type) return null;
    if (f.place && t >= f.end) return f.place; // about to lock: where it did
    if (!f.path) {
      // A held piece in a shared game: shown where it came out.
      const s = spawnAt(f.type, f.board);
      f.path = f.place ? synthPath(f) : [[f.start, s.x, s.y, s.r]];
    }
    let point = f.path[0];
    for (const p of f.path) {
      if (p[0] > t) break;
      point = p;
    }
    return { type: f.type, x: point[1], y: point[2], r: point[3] };
  }

  // A match and how it went, as a replay link keeps them: bit 0 for a
  // match, bits 1 and 2 for won (1) or lost (2).
  function resultFlags(m) {
    if (!m) return 0;
    return 1 | (m.result === "won" ? 2 : m.result === "lost" ? 4 : 0);
  }

  function openReplay() {
    if (replay) return;
    if (watching) {
      startReplay(watching.frames, watching.link, null);
      return;
    }
    if (!over || !log.length) return;
    startReplay(replayFrames(log, seed, trails), null, { log, seed, match }, match && oppTrail.length ? oppTrail : null);
  }

  // source is the game to pack into a link: { log, seed, match }. opp is a
  // match's other board over time, shown in its card in step with this one.
  function startReplay(frames, link, source, opp = null) {
    const r = {
      frames,
      total: frames[frames.length - 1].start,
      i: 0,
      t: 0,
      playing: true,
      link,
      source,
      opp,
      shown: -1,
      oppShown: -2,
    };
    replay = r;
    replayUI.seek.max = String(r.total);
    setShareNote("");
    hideOverlay();
    game.classList.add("replaying");
    fit();
    showReplayFrame();
    if (!link && source) prepareLink(r);
  }

  // Packed in the background, so Share can hand the link over at once. Packed
  // again when a match's result arrives after its replay has opened.
  function prepareLink(r) {
    const job = {};
    r.link = null;
    r.packing = job;
    packReplay({ ...r.source, flags: resultFlags(r.source.match) })
      .then((packed) => {
        if (packed && r.packing === job) r.link = replayLink(packed);
      })
      .catch(() => {});
  }

  // Back to the screen it came from, or straight on when a new game is starting.
  function closeReplay(backToOverlay = true) {
    if (!replay) return;
    replay = null;
    if (game.contains(document.activeElement)) document.activeElement.blur();
    game.classList.remove("replaying");
    fit();
    dirty = true;
    drawMinis();
    updateStats();
    drawOpponent(); // back to the other board as it is now
    if (backToOverlay) showOverlay(watching ? "shared" : "over");
  }

  const clockText = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  // Only written when it differs: this runs every frame while playing.
  const put = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const attr = (el, name, value) => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };

  function showReplayFrame() {
    const { frames, i, t, total, playing } = replay;
    const f = frames[i];
    const last = frames.length - 1;
    const pos =
      i === last
        ? "Game over"
        : f.held
          ? `Piece ${f.piece + 1} of ${frames[last].piece}, held`
          : `Piece ${f.piece} of ${frames[last].piece}`;
    dirty = true;
    if (replay.shown !== i) {
      replay.shown = i;
      drawMinis();
      updateStats();
    }
    if (replay.opp) {
      const k = opponentAt(replay.opp, t);
      if (replay.oppShown !== k) {
        replay.oppShown = k;
        drawOpponent();
      }
    }
    put(replayUI.time, `${clockText(t)} / ${clockText(total)}`);
    put(replayUI.pos, shareNote || pos);
    replayUI.seek.value = String(Math.round(t));
    attr(replayUI.seek, "aria-valuetext", `${clockText(t)}, ${pos}`);
    attr(replayUI.play, "data-playing", String(playing));
    attr(replayUI.play, "aria-label", playing ? "Pause replay" : "Play replay");
    // Read out while stepping, not sixty times a second while playing.
    attr(replayUI.pos, "aria-live", playing ? "off" : "polite");
  }

  // The frame on screen at time t: the first piece still in play then, or
  // the end once the game is over.
  function frameAt(t) {
    const { frames, total } = replay;
    const last = frames.length - 1;
    if (t >= total) return last;
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].end < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  // Seeking or stepping stops play, to look at the move.
  function replaySeek(t) {
    replay.playing = false;
    replay.t = Math.max(0, Math.min(replay.total, t));
    replay.i = frameAt(replay.t);
    showReplayFrame();
  }

  // A step lands on a piece where it locked. Forward from partway through
  // a piece goes to its lock, back goes to the lock before.
  function replayStep(dir) {
    const { frames } = replay;
    const last = frames.length - 1;
    let { i, t } = replay;
    if (dir > 0) {
      if (i < last && t < frames[i].end) t = frames[i].end;
      else if (i < last) t = frames[++i].end;
    } else if (i > 0) {
      t = frames[--i].end;
    } else {
      t = 0;
    }
    replay.playing = false;
    replay.i = i;
    replay.t = t;
    showReplayFrame();
  }

  // Play from the end starts again from the top.
  function replayToggle() {
    replay.playing = !replay.playing;
    if (replay.playing && replay.i === replay.frames.length - 1) {
      replay.i = 0;
      replay.t = 0;
    }
    showReplayFrame();
  }

  // A replay that is playing goes on at the new pace from where it is.
  function setReplaySpeed(speed, save = true) {
    if (!REPLAY_SPEEDS.includes(speed)) return;
    replaySpeed = speed;
    if (save) {
      try {
        localStorage.setItem(SPEED_KEY, String(speed));
      } catch {
        // Kept for this page view only.
      }
    }
    replayUI.speed.querySelectorAll("[data-speed]").forEach((el) => {
      const on = Number(el.dataset.speed) === speed;
      el.classList.toggle("active", on);
      el.setAttribute("aria-checked", String(on));
    });
  }

  function replayTick(dt) {
    const { frames } = replay;
    const last = frames.length - 1;
    replay.t = Math.min(replay.total, replay.t + dt * replaySpeed);
    while (replay.i < last && replay.t > frames[replay.i].end) replay.i++;
    if (replay.t >= replay.total) {
      replay.i = last;
      replay.playing = false;
    }
    showReplayFrame();
  }

  function setShareNote(text) {
    clearTimeout(shareNoteTimer);
    shareNote = text;
    if (text) {
      shareNoteTimer = setTimeout(() => {
        shareNote = "";
        if (replay) showReplayFrame();
      }, 2500);
    }
    if (replay) showReplayFrame();
  }

  // Through the device's share sheet where it has one, the clipboard otherwise.
  async function shareReplay() {
    const r = replay;
    if (!r) return;
    if (!r.link) {
      replayUI.share.disabled = true;
      try {
        const packed = await packReplay({ ...r.source, flags: resultFlags(r.source.match) });
        if (packed) r.link = replayLink(packed);
      } finally {
        replayUI.share.disabled = false;
      }
      if (!r.link) {
        setShareNote("Could not make a link");
        return;
      }
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: "Tetris replay", text: "Watch this game of Tetris.", url: r.link });
        if (replay === r) setShareNote("Shared");
        return;
      } catch (err) {
        // Dismissed: nothing to say. Refused or unsupported here: copy instead.
        if (err?.name === "AbortError") return;
      }
    }
    const copied = await copyText(r.link);
    if (replay === r) setShareNote(copied ? "Link copied" : "Copy failed");
  }

  // The game's keys and pad, while a replay is open: left and right step,
  // pause and hard drop play and pause, other moves do nothing. Restart and
  // autoplay still start a new game, which closes the replay.
  function replayPress(action) {
    switch (action) {
      case "left":
        replayStep(-1);
        return true;
      case "right":
        replayStep(1);
        return true;
      case "pause":
      case "hard":
        replayToggle();
        return true;
      case "reset":
      case "autoplay":
        return false;
      default:
        return true;
    }
  }

  /* -- Replay links --
     A link holds the whole game, so nothing is stored anywhere, and it opens
     offline once the site has been visited. In the spirit of the chess
     game's links, which store each move as its place in the list of legal
     moves, each lock here is its place in the list of spots the piece could
     have dropped straight to, best first by the autoplay's judgement: a
     sound move is a small number, and small numbers pack tight. A tuck or a
     spin under an overhang is spelt out instead. Times are kept to the
     nearest step of 0.1 s, coarser the longer the game, and the lot is
     deflated, so a long game costs a few characters a piece.

     Bytes: version (high bit set when deflated), then flags, time step,
     seed length, the seed, the entry count, a rank per entry, each entry's
     time since the one before in steps, each entry's drop points, and the
     extra bytes ranks LINK_GARBAGE and LINK_ELSEWHERE need, in order. */

  const LINK_VERSION = 1;
  // Frozen: links already shared rank their spots by these. Retune the
  // autoplay through AUTO_WEIGHTS, never here, or old links play out wrong.
  const LINK_WEIGHTS = {
    height: -4.500158825082766,
    cleared: 3.4181268101392694,
    rowTransitions: -3.2178882868487753,
    colTransitions: -9.348695305445199,
    holes: -7.899265427351652,
    wells: -3.3855972247263626,
  };
  // ms a time step stands for, and the longest game each is used for: 0.1 s
  // up to 5 minutes, then 0.2 s, 0.5 s and 1 s.
  const LINK_UNITS = [100, 200, 500, 1000];
  const LINK_UNIT_UNTIL = [5 * 60000, 15 * 60000, 45 * 60000, Infinity];
  const LINK_GARBAGE = 253; // then rows and the gap's column
  const LINK_HOLD = 254;
  const LINK_ELSEWHERE = 255; // then r, x + 8 and y + 8
  const LINK_MAX_ENTRIES = 100000;
  const LINK_MAX_POINTS = 10000;
  // Work done between breaths, so packing a long game never stalls a frame.
  const LINK_CHUNK = 200;

  const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

  // Every spot the piece reaches by dropping straight down, after turning
  // and sliding above the stack, best first by LINK_WEIGHTS. Ties keep this
  // order, so the list is the same on every device.
  function placements(grid, type) {
    const seen = new Set();
    const list = [];
    for (let r = 0; r < 4; r++) {
      for (let x = -3; x < COLS; x++) {
        const p = { type, r, x, y: -4 };
        if (collides(p, grid)) continue;
        while (!collides({ ...p, y: p.y + 1 }, grid)) p.y++;
        const key = cellsKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        list.push({ p, key, score: evaluate(p, grid, LINK_WEIGHTS) });
      }
    }
    list.sort((a, b) => (a.score === b.score ? 0 : a.score > b.score ? -1 : 1));
    return list;
  }

  function writeVarint(out, n) {
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80);
      n = Math.floor(n / 0x80);
    }
    out.push(n);
  }

  // Reads bytes in order, throwing when they run out.
  function reader(bytes) {
    let at = 0;
    const need = (n) => {
      if (at + n > bytes.length) throw new RangeError("short");
    };
    return {
      byte() {
        need(1);
        return bytes[at++];
      },
      bytes(n) {
        need(n);
        at += n;
        return bytes.subarray(at - n, at);
      },
      varint() {
        let n = 0;
        for (let shift = 0; shift < 35; shift += 7) {
          const b = this.byte();
          n += (b & 0x7f) * 2 ** shift;
          if (!(b & 0x80)) return n;
        }
        throw new RangeError("varint");
      },
    };
  }

  async function squeeze(bytes, Stream) {
    const stream = new Blob([bytes]).stream().pipeThrough(new Stream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function toBase64Url(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(text) {
    if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
    try {
      return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }

  function replayLink(packed) {
    return `${location.origin}/?r=${packed}`;
  }

  // The game as a link's text, or null if it would not pack.
  async function packReplay({ log: entries, seed: text, flags }) {
    if (!entries.length || entries.length > LINK_MAX_ENTRIES) return null;
    const length = entries[entries.length - 1].at(-2);
    const unit = LINK_UNIT_UNTIL.findIndex((until) => length <= until);
    const sim = new Sim(text);
    const ranks = [];
    const times = [];
    const points = [];
    const extra = [];
    let prev = 0;

    for (let k = 0; k < entries.length; k++) {
      if (k && k % LINK_CHUNK === 0) await breathe();
      const entry = entries[k];
      const [t, pts] = entry.slice(-2);
      const move = entry.slice(0, -2);
      // Rounded on the running total, so the steps never drift from the clock.
      const q = Math.max(prev, Math.round(t / LINK_UNITS[unit]));
      times.push(q - prev);
      prev = q;
      points.push(pts);
      if (move[0] === "H") {
        ranks.push(LINK_HOLD);
      } else if (move[0] === "G") {
        ranks.push(LINK_GARBAGE);
        extra.push(move[1], move[2]);
      } else {
        const p = { type: move[0], r: move[1], x: move[2], y: move[3] };
        const key = cellsKey(p);
        const rank = placements(sim.grid, p.type).findIndex((s) => s.key === key);
        if (rank >= 0) {
          ranks.push(rank);
        } else {
          ranks.push(LINK_ELSEWHERE);
          extra.push(p.r, p.x + 8, p.y + 8);
        }
      }
      sim.apply(move, pts);
    }

    const seedBytes = new TextEncoder().encode(text);
    const body = [flags, unit, seedBytes.length];
    for (const b of seedBytes) body.push(b);
    writeVarint(body, entries.length);
    for (const b of ranks) body.push(b);
    for (const n of times) writeVarint(body, n);
    for (const n of points) writeVarint(body, n);
    for (const b of extra) body.push(b);
    const raw = Uint8Array.from(body);

    let packed = null;
    try {
      packed = await squeeze(raw, CompressionStream);
    } catch {
      // No CompressionStream in this browser: the link goes out as it is.
    }
    const deflated = packed !== null && packed.length < raw.length;
    const payload = deflated ? packed : raw;
    const out = new Uint8Array(payload.length + 1);
    out[0] = LINK_VERSION | (deflated ? 0x80 : 0);
    out.set(payload, 1);
    return toBase64Url(out);
  }

  // { seed, flags, log } from a link's text, or null if it is damaged. Every
  // piece is checked as it is placed, so a damaged link cannot play an
  // impossible game: it stops, and says so.
  async function unpackReplay(text) {
    const bytes = fromBase64Url(text);
    if (!bytes || bytes.length < 2 || (bytes[0] & 0x7f) !== LINK_VERSION) return null;
    const body = bytes[0] & 0x80 ? await squeeze(bytes.subarray(1), DecompressionStream) : bytes.subarray(1);
    const rd = reader(body);
    const flags = rd.byte();
    const unit = LINK_UNITS[rd.byte()];
    const seedText = new TextDecoder("utf-8", { fatal: true }).decode(rd.bytes(rd.byte()));
    if (!unit || !seedText || cleanSeed(seedText) !== seedText) return null;
    const n = rd.varint();
    if (n < 1 || n > LINK_MAX_ENTRIES) return null;
    const ranks = rd.bytes(n);
    const times = Array.from({ length: n }, () => rd.varint());
    const points = Array.from({ length: n }, () => rd.varint());

    const sim = new Sim(seedText);
    const log = [];
    let t = 0;
    for (let k = 0; k < n; k++) {
      if (k && k % LINK_CHUNK === 0) await breathe();
      if (sim.over || points[k] > LINK_MAX_POINTS) return null;
      t += times[k] * unit;
      const rank = ranks[k];
      let move;
      if (rank === LINK_HOLD) {
        if (!sim.canHold) return null;
        move = ["H", sim.cur];
      } else if (rank === LINK_GARBAGE) {
        const rows = rd.byte();
        const hole = rd.byte();
        if (rows < 1 || rows > ROWS || hole >= COLS) return null;
        move = ["G", rows, hole];
      } else {
        let p;
        if (rank === LINK_ELSEWHERE) {
          p = { type: sim.cur, r: rd.byte(), x: rd.byte() - 8, y: rd.byte() - 8 };
          // Resting on something, in cells that are free.
          if (p.r > 3 || collides(p, sim.grid) || !collides({ ...p, y: p.y + 1 }, sim.grid)) return null;
        } else {
          p = placements(sim.grid, sim.cur)[rank]?.p;
          if (!p) return null;
        }
        move = [p.type, p.r, p.x, p.y];
      }
      log.push([...move, t, points[k]]);
      sim.apply(move, points[k]);
    }
    return { seed: seedText, flags, log };
  }

  /* -- Shared replays --
     Opening a replay link (?r=) plays it in place of a new game. Starting a
     game, by any route, takes the link out of the address. */

  let watching = null; // { seed, flags, log, frames, link } of the link opened
  let watchToken = 0;

  async function watchShared(text) {
    const token = ++watchToken;
    showOverlay("loading");
    let shared = null;
    try {
      shared = await unpackReplay(text);
    } catch {
      shared = null;
    }
    if (token !== watchToken) return; // a game was started meanwhile
    if (!shared) {
      showOverlay("damaged");
      return;
    }
    const frames = replayFrames(shared.log, shared.seed, null);
    watching = { ...shared, frames, link: replayLink(text) };
    startReplay(frames, watching.link, null);
  }

  function forgetShared() {
    watchToken++;
    watching = null;
    const params = new URLSearchParams(location.search);
    if (!params.has("r")) return;
    params.delete("r");
    const rest = params.toString();
    history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);
  }

  function sharedLine() {
    const end = watching.frames[watching.frames.length - 1];
    const line = `Score ${end.score.toLocaleString()}, ${end.lines} ${end.lines === 1 ? "line" : "lines"}.`;
    if (!(watching.flags & 1)) return line;
    const result = (watching.flags >> 1) & 3;
    return `${line} ${result === 1 ? "Won a match" : result === 2 ? "Lost a match" : "A match"} against another device.`;
  }

  /* -- Drawing -- */

  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const token = (name) => cs.getPropertyValue(name).trim();
    palette = {
      board: token("--board-bg"),
      grid: token("--board-grid"),
      ghostFill: token("--ghost-fill"),
      ghostStroke: token("--ghost-stroke"),
      shine: token("--piece-shine"),
      incoming: token("--error"),
      piece: Object.fromEntries([...TYPES, "G"].map((t) => [t, token(`--piece-${t.toLowerCase()}`)])),
    };
    dirty = true;
    drawMinis();
    drawOpponent();
  }

  function roundedRect(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) c.roundRect(x, y, w, h, r);
    else c.rect(x, y, w, h);
  }

  function cellBox(x, y, size) {
    const inset = Math.max(1, Math.round(size * 0.04));
    return {
      px: x * size + inset,
      py: y * size + inset,
      s: size - inset * 2,
      r: Math.max(2, size * 0.18),
    };
  }

  function paintCell(c, x, y, size, color) {
    const { px, py, s, r } = cellBox(x, y, size);
    c.fillStyle = color;
    roundedRect(c, px, py, s, s, r);
    c.fill();
    c.fillStyle = palette.shine;
    roundedRect(c, px, py, s, Math.max(2, s * 0.3), r);
    c.fill();
  }

  function paintGhost(x, y) {
    const { px, py, s, r } = cellBox(x, y, tile);
    ctx.fillStyle = palette.ghostFill;
    roundedRect(ctx, px, py, s, s, r);
    ctx.fill();
    ctx.strokeStyle = palette.ghostStroke;
    ctx.lineWidth = 1;
    roundedRect(ctx, px + 0.5, py + 0.5, s - 1, s - 1, r);
    ctx.stroke();
  }

  // Where p would land on grid.
  function ghostOf(p, grid) {
    let y = p.y;
    while (!collides({ ...p, y: y + 1 }, grid)) y++;
    return { ...p, y };
  }

  // A piece in a replay, drawn where it locked and ringed so it stands out
  // from the stack.
  function paintPlaced(x, y, type) {
    paintCell(ctx, x, y, tile, palette.piece[type]);
    const { px, py, s, r } = cellBox(x, y, tile);
    ctx.strokeStyle = palette.ghostStroke;
    ctx.lineWidth = 2;
    roundedRect(ctx, px + 1, py + 1, s - 2, s - 2, r);
    ctx.stroke();
  }

  // A piece with its ghost below it, on grid.
  function paintFalling(p, grid) {
    const ghost = ghostOf(p, grid);
    if (ghost.y !== p.y) {
      for (const [x, y] of cellsOf(ghost)) if (y >= 0) paintGhost(x, y);
    }
    for (const [x, y] of cellsOf(p)) {
      if (y >= 0) paintCell(ctx, x, y, tile, palette.piece[p.type]);
    }
  }

  function draw() {
    dirty = false;
    const view = replay && replay.frames[replay.i];
    const cells = view ? view.board : board;
    const w = COLS * tile;
    const h = ROWS * tile;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = palette.board;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < COLS; x++) {
      ctx.moveTo(x * tile + 0.5, 0);
      ctx.lineTo(x * tile + 0.5, h);
    }
    for (let y = 1; y < ROWS; y++) {
      ctx.moveTo(0, y * tile + 0.5);
      ctx.lineTo(w, y * tile + 0.5);
    }
    ctx.stroke();

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (cells[y][x]) paintCell(ctx, x, y, tile, palette.piece[cells[y][x]]);
      }
    }

    if (view) {
      const p = replayPiece(view, replay.t);
      if (p && view.place && replay.t >= view.end) {
        for (const [x, y] of cellsOf(p)) if (y >= 0) paintPlaced(x, y, p.type);
      } else if (p) {
        paintFalling(p, cells);
      }
      return;
    }
    if (cur && !over) paintFalling(cur, board);

    // Garbage on its way, as a bar up the right edge, a row for a row.
    if (incoming > 0) {
      const rows = Math.min(incoming, ROWS);
      ctx.fillStyle = palette.incoming;
      ctx.fillRect(w - 4, h - rows * tile, 4, rows * tile);
    }
  }

  // A piece centred in a 4 x 2 preview, by its own bounding box.
  function drawMini(cv, type, dim) {
    const c = cv.getContext("2d");
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    c.clearRect(0, 0, w, h);
    if (!type || !palette || !w) return;

    const cells = SHAPES[type][0];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const size = Math.min(w / MINI_COLS, h / MINI_ROWS);
    const ox = (w - (Math.max(...xs) - minX + 1) * size) / 2;
    const oy = (h - (Math.max(...ys) - minY + 1) * size) / 2;

    c.save();
    c.translate(ox, oy);
    c.globalAlpha = dim ? 0.4 : 1;
    for (const [x, y] of cells) paintCell(c, x - minX, y - minY, size, palette.piece[type]);
    c.restore();
  }

  function drawMinis() {
    if (!palette) return;
    const v = replay ? replay.frames[replay.i] : { hold, canHold, next: queue };
    drawMini(holdCanvas, v.hold, !v.canHold);
    nextCanvases.forEach((cv, i) => drawMini(cv, v.next[i], false));
    holdCanvas.setAttribute("aria-label", v.hold ? `Hold: ${v.hold} piece` : "Hold: empty");
    nextList.setAttribute("aria-label", `Next pieces: ${v.next.slice(0, NEXT_COUNT).join(", ")}`);
  }

  // A cell too small for paintCell's rounding and shine, which turn it into
  // a dot: a plain square with a hairline gap.
  function paintSmall(c, x, y, size, color) {
    c.fillStyle = color;
    c.fillRect(x * size + 0.5, y * size + 0.5, size - 1, size - 1);
  }

  // The other device's board, small, in its card, with its score. Hidden
  // outside versus. In a match's replay, the board as it stood at that
  // moment of the replay; otherwise as it is now.
  function drawOpponent() {
    if (!oppCanvas) return;
    let view = opponent;
    if (replay?.opp) {
      const k = opponentAt(replay.opp, replay.t);
      view = k < 0 ? null : replay.opp[k].view;
    }
    const info = $("oppInfo");
    const text = view
      ? `Score ${view.score.toLocaleString()}, ${view.lines} ${view.lines === 1 ? "line" : "lines"}`
      : replay?.opp
        ? "Getting ready"
        : "Waiting for a match";
    if (info.textContent !== text) info.textContent = text;

    if (!palette) return;
    const w = oppCanvas.clientWidth;
    const h = oppCanvas.clientHeight;
    if (!w || !dpr) return;
    if (oppCanvas.width !== Math.round(w * dpr)) setBuffer(oppCanvas, w, h);
    const c = oppCanvas.getContext("2d");
    const size = w / COLS;
    c.clearRect(0, 0, w, h);
    c.fillStyle = palette.board;
    c.fillRect(0, 0, w, h);
    if (!view) return;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const type = view.cells[y * COLS + x];
        if (type !== ".") paintSmall(c, x, y, size, palette.piece[type]);
      }
    }
    if (view.cur) {
      const [type, r, x, y] = view.cur;
      for (const [cx, cy] of cellsOf({ type, r, x, y })) {
        if (cy >= 0) paintSmall(c, cx, cy, size, palette.piece[type]);
      }
    }
  }

  /* -- Sizing -- */

  function setBuffer(cv, w, h) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Whole tiles only, so grid lines stay crisp. The width comes from the grid
  // container rather than the board's own column, which is sized by the board.
  function fit() {
    const gs = getComputedStyle(game);
    const inner = game.clientWidth - parseFloat(gs.paddingLeft) - parseFloat(gs.paddingRight);
    const side = parseFloat(gs.getPropertyValue("--side-w")) || 0; // side column minimum
    const gap = parseFloat(gs.columnGap) || 0;
    const frame = 2; // the glass border around the canvas
    const maxW = inner - side - gap - frame;
    const maxH = (parseFloat(getComputedStyle(wrap).maxHeight) || 600) - frame;

    const nextTile = Math.max(8, Math.floor(Math.min(maxW / COLS, maxH / ROWS)));
    const nextDpr = Math.max(1, window.devicePixelRatio || 1);

    if (nextTile !== tile || nextDpr !== dpr) {
      tile = nextTile;
      dpr = nextDpr;
      canvas.style.width = `${COLS * tile}px`;
      canvas.style.height = `${ROWS * tile}px`;
      setBuffer(canvas, COLS * tile, ROWS * tile);
      if (oppCanvas) oppCanvas.width = 0; // drawOpponent sizes it afresh
      dirty = true;
    }

    for (const cv of [holdCanvas, ...nextCanvases]) setBuffer(cv, cv.clientWidth, cv.clientHeight);
    drawMinis();
    drawOpponent();
  }

  /* -- Loop -- */

  // The most of a hidden tab's absence a match plays out on return.
  const MATCH_CATCH_UP_MS = 120000;
  const CATCH_UP_STEP_MS = 50;

  function loop(ts) {
    const elapsed = lastFrame === null ? 0 : ts - lastFrame;
    const dt = Math.min(elapsed, 100);
    lastFrame = ts;

    // Any modal holds the game still, without the Paused screen. Not a
    // match: that would be a pause by another name, while the other board
    // carries on.
    const modalOpen = document.body.classList.contains("modal-open");
    const freeze = modalOpen && !(match && !over);
    if (freeze && !suspended) releaseAll();
    suspended = freeze;

    // A match's countdown runs on the wall clock, the same on both devices.
    if (countdownEnd) {
      const left = countdownEnd - performance.now();
      if (left <= 0) {
        countdownEnd = 0;
        if (overlayKind === "countdown") hideOverlay();
      } else if (overlayKind === "countdown") {
        put(overlay.title, String(Math.ceil(left / 1000)));
      }
    }

    // A hidden tab gets no frames, which would freeze a match as well as a
    // pause would. So a match plays out the time it missed on return, a
    // step at a time, gravity and lock delay and all: the pieces fall and
    // lock where they would have.
    let left = match && !over ? Math.min(elapsed, MATCH_CATCH_UP_MS) : dt;
    while (left > 0 && playing()) {
      const d = Math.min(left, CATCH_UP_STEP_MS);
      left -= d;
      clock += d;
      step();
      if (autoplay && playing() && clock - autoAt >= AUTO_STEP) {
        autoAt = clock;
        autoStep();
      }
    }
    if (replay?.playing && !modalOpen) replayTick(dt);
    if (dirty) draw();
    requestAnimationFrame(loop);
  }

  /* -- Input -- */

  const held = new Set(); // "left", "right", "soft"
  let shiftDir = 0;
  let dasTimer = 0;
  let arrTimer = 0;
  let softTimer = 0;

  function startShift(dir) {
    stopShift();
    shiftDir = dir;
    move(dir);
    dasTimer = setTimeout(() => {
      arrTimer = setInterval(() => move(dir), ARR);
    }, DAS);
  }

  function stopShift() {
    clearTimeout(dasTimer);
    clearInterval(arrTimer);
    dasTimer = 0;
    arrTimer = 0;
    shiftDir = 0;
  }

  const MOVES = new Set(["left", "right", "soft", "hard", "cw", "ccw", "hold"]);

  function press(action) {
    if (replay && replayPress(action)) return;
    // Playing a move by hand takes over from autoplay.
    if (autoplay && MOVES.has(action)) autoplay = false;
    switch (action) {
      case "left":
        held.add("left");
        startShift(-1);
        break;
      case "right":
        held.add("right");
        startShift(1);
        break;
      case "soft":
        held.add("soft");
        clearInterval(softTimer);
        softDrop();
        softTimer = setInterval(softDrop, SOFT_DROP_EVERY);
        break;
      case "hard":
        hardDrop();
        break;
      case "cw":
        rotate(1);
        break;
      case "ccw":
        rotate(-1);
        break;
      case "hold":
        holdPiece();
        break;
      case "pause":
        setPaused(!paused);
        break;
      case "resume":
        setPaused(false);
        break;
      case "reset":
        newGame();
        break;
      case "autoplay":
        toggleAutoplay();
        break;
      case "replay":
        openReplay();
        break;
    }
  }

  // Each held action has its own timer, so letting go of one never strands
  // or cancels another.
  function release(action) {
    if (!held.delete(action)) return;
    if (action === "soft") {
      clearInterval(softTimer);
      softTimer = 0;
      return;
    }
    const dir = action === "left" ? -1 : 1;
    if (shiftDir === dir) {
      stopShift();
      // Still holding the other way: carry on in that direction.
      if (held.has("left")) startShift(-1);
      else if (held.has("right")) startShift(1);
    }
  }

  function releaseAll() {
    held.clear();
    stopShift();
    clearInterval(softTimer);
    softTimer = 0;
    document.querySelectorAll(".pad-btn.pressed").forEach((b) => b.classList.remove("pressed"));
  }

  // Letters by the character typed, so Z means the key labelled Z on any
  // layout; the codes cover layouts that type no Latin letters at all.
  const KEY_ACTIONS = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowDown: "soft",
    ArrowUp: "cw",
    " ": "hard",
    x: "cw",
    z: "ccw",
    c: "hold",
    Shift: "hold",
    p: "pause",
    Escape: "pause",
    r: "reset",
    F2: "autoplay",
  };
  const CODE_ACTIONS = { KeyX: "cw", KeyZ: "ccw", KeyC: "hold", KeyP: "pause", KeyR: "reset" };

  function actionFor(e) {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    return KEY_ACTIONS[key] ?? CODE_ACTIONS[e.code];
  }

  // Space on a button reached by keyboard presses that button, not hard drop.
  function meantForControl(e) {
    return (
      e.key === " " &&
      e.target instanceof Element &&
      e.target.closest("button, a, input, select, textarea") !== null &&
      e.target.matches(":focus-visible")
    );
  }

  // Typing a leaderboard name is not playing: R in a name must not restart.
  // The replay's slider is not typing: the arrows step it like everywhere else.
  function typing(e) {
    return (
      e.target instanceof Element &&
      (e.target.closest('input:not([type="range"]), textarea, select') !== null || e.target.isContentEditable)
    );
  }

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains("modal-open") || typing(e) || meantForControl(e)) return;

    // Esc leaves a replay rather than pausing.
    if (replay && e.key === "Escape") {
      e.preventDefault();
      closeReplay();
      return;
    }

    const action = actionFor(e);
    if (!action) return;
    e.preventDefault(); // arrows and Space would otherwise scroll the page
    // Repeats come from our own timers, except that holding an arrow runs
    // through a replay.
    if (e.repeat && !(replay && (action === "left" || action === "right"))) return;
    press(action);
  });

  window.addEventListener("keyup", (e) => {
    const action = actionFor(e);
    if (action) release(action);
  });

  // A key let go in another window never sends keyup here.
  window.addEventListener("blur", releaseAll);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      releaseAll();
      setPaused(true);
    }
  });

  document.querySelectorAll(".pad-btn").forEach((btn) => {
    const action = btn.dataset.act;

    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // no focus ring, no text selection, no double-tap zoom
      try {
        btn.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is already gone; the press still counts.
      }
      btn.classList.add("pressed");
      press(action);
    });

    const up = () => {
      btn.classList.remove("pressed");
      release(action);
    };
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointercancel", up);
    btn.addEventListener("lostpointercapture", up);

    // Enter or Space on a focused button arrives as a click with no pointer.
    btn.addEventListener("click", (e) => {
      if (e.detail !== 0) return;
      press(action);
      release(action);
    });
  });

  overlay.root.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-game-act]");
    if (btn) press(btn.dataset.gameAct);
  });

  const replayBar = $("replayBar");

  // No focus left on a tapped or clicked button, as on the pad, so Space
  // goes on playing and pausing rather than pressing it again.
  replayBar.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) e.preventDefault();
  });

  replayBar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-replay], [data-speed]");
    if (!btn || !replay) return;
    if (btn.dataset.speed) {
      setReplaySpeed(Number(btn.dataset.speed));
      return;
    }
    switch (btn.dataset.replay) {
      case "back":
        replayStep(-1);
        break;
      case "forward":
        replayStep(1);
        break;
      case "play":
        replayToggle();
        break;
      case "share":
        shareReplay();
        break;
      case "close":
        closeReplay();
        break;
    }
  });

  replayUI.seek.addEventListener("input", () => {
    if (replay) replaySeek(Number(replayUI.seek.value));
  });

  // Touch's F2: three quick taps on the name in the top bar. Mice keep F2.
  const TRIPLE_TAP_MS = 400; // most allowed between one tap and the next
  let brandTaps = 0;
  let brandTapAt = 0;

  document.querySelector(".brand").addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    brandTaps = e.timeStamp - brandTapAt <= TRIPLE_TAP_MS ? brandTaps + 1 : 1;
    brandTapAt = e.timeStamp;
    if (brandTaps < 3) return;
    brandTaps = 0;
    press("autoplay");
  });

  /* -- Touch gestures on the board --
     Drag sideways to move, one cell per cell of drag. Drag down slowly to
     soft drop. Flick down to hard drop, flick up to hold. Tap to rotate.
     The board has touch-action: none and the page overscroll-behavior: none
     (style.css), so none of this reaches the browser as a scroll, a pull to
     refresh or a zoom. */

  const frame = canvas.parentElement;
  const gestureHint = $("gestureHint");
  const SLOP = 10; // px of travel before a touch counts as a drag
  const TAP_MS = 250;
  // px per ms over the last stretch of the gesture. A real flick runs 1 to 3;
  // a deliberate soft drop drag, around 0.2.
  const FLICK_SPEED = 0.6;
  const FLICK_WINDOW_MS = 100;
  const HINT_SEEN = "uwutetris.gesturesSeen";

  let gesture = null;

  function hideGestureHint() {
    if (gestureHint.classList.contains("hidden")) return;
    gestureHint.classList.add("hidden");
    try {
      localStorage.setItem(HINT_SEEN, "1");
    } catch {
      // Shown again next visit, then.
    }
  }

  frame.addEventListener("pointerdown", (e) => {
    // In a replay, a tap or click on the board plays and pauses it, as on a video.
    if (replay) {
      if (e.button === 0) replayToggle();
      return;
    }
    // Mice keep the keyboard; the overlay's buttons and name field keep their taps.
    if (e.pointerType === "mouse" || gesture || e.target.closest(".board-overlay")) return;
    e.preventDefault();
    try {
      frame.setPointerCapture(e.pointerId);
    } catch {
      // Still tracked while the finger stays on the board.
    }
    gesture = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      t: e.timeStamp,
      axis: null,
      movedX: 0,
      droppedY: 0,
      samples: [{ y: e.clientY, t: e.timeStamp }],
    };
  });

  frame.addEventListener("pointermove", (e) => {
    if (!gesture || e.pointerId !== gesture.id) return;
    const dx = e.clientX - gesture.x;
    const dy = e.clientY - gesture.y;
    gesture.samples.push({ y: e.clientY, t: e.timeStamp });
    while (gesture.samples.length > 2 && e.timeStamp - gesture.samples[1].t > FLICK_WINDOW_MS) gesture.samples.shift();

    // One axis per gesture, so a sideways drag never soft drops by accident.
    if (!gesture.axis && Math.max(Math.abs(dx), Math.abs(dy)) >= SLOP) {
      gesture.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (gesture.axis === "x") {
      const target = Math.trunc(dx / tile);
      while (gesture.movedX < target) {
        move(1);
        gesture.movedX++;
      }
      while (gesture.movedX > target) {
        move(-1);
        gesture.movedX--;
      }
    } else if (gesture.axis === "y" && dy > 0) {
      const rows = Math.trunc(dy / tile);
      while (gesture.droppedY < rows) {
        softDrop();
        gesture.droppedY++;
      }
    }
  });

  function endGesture(e, cancelled) {
    if (!gesture || e.pointerId !== gesture.id) return;
    const g = gesture;
    gesture = null;
    if (cancelled) return;

    const dy = e.clientY - g.y;
    const from = g.samples[0];
    const speed = (e.clientY - from.y) / Math.max(1, e.timeStamp - from.t);

    if (!g.axis) {
      if (e.timeStamp - g.t <= TAP_MS) rotate(1);
    } else if (g.axis === "y") {
      if (speed >= FLICK_SPEED && dy >= tile) hardDrop();
      else if (speed <= -FLICK_SPEED && dy <= -tile) holdPiece();
    }
    hideGestureHint();
  }

  frame.addEventListener("pointerup", (e) => endGesture(e, false));
  frame.addEventListener("pointercancel", (e) => endGesture(e, true));

  // First visit on a touch screen: say what the board does, until it is used.
  try {
    if (matchMedia("(pointer: coarse)").matches && !localStorage.getItem(HINT_SEEN)) {
      gestureHint.classList.remove("hidden");
    }
  } catch {
    // Storage blocked: skip the hint rather than show it every time.
  }

  /* -- For the modules --
     js/app.js opens the replay when a game ends, and js/versus.js plays
     matches through the rest. */

  window.uwuTetris = {
    openReplay,
    startMatch,
    setMatchResult,
    endVersus,
    snapshot,
    setOpponentSent,
    setOpponent,
    matchId: () => match?.id ?? 0,
    matchLive: () => Boolean(match && !over),
    newSeed: randomSeed,
  };

  /* -- Start -- */

  new MutationObserver(readPalette).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode", "data-color-theme"],
  });

  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(game);
  window.addEventListener("resize", fit);

  try {
    const saved = Number(localStorage.getItem(SPEED_KEY));
    setReplaySpeed(REPLAY_SPEEDS.includes(saved) ? saved : 1, false);
  } catch {
    setReplaySpeed(1, false);
  }

  readPalette();
  fit();
  const sharedLink = new URLSearchParams(location.search).get("r");
  if (sharedLink) watchShared(sharedLink);
  else reset();
  if (document.hidden) setPaused(true);
  requestAnimationFrame(loop);
})();

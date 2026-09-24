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
  };

  // Board cells hold a piece type, not a colour, so a theme change recolours
  // pieces that have already landed.
  const board = Array.from({ length: ROWS }, () => Array(COLS).fill(""));

  let tile = 0;
  let dpr = 0;
  let palette = null;
  let dirty = true;

  let bag = [];
  let queue = [];
  let cur = null;
  let hold = null;
  let canHold = true;
  let score = 0;
  let lines = 0;
  let level = 1;
  let pieces = 0; // locked this game; the leaderboard checks the score against it
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

  /* -- Pieces -- */

  // 7-bag: every piece once per seven, in a fair Fisher-Yates order.
  function nextFromBag() {
    if (!bag.length) {
      bag = [...TYPES];
      for (let i = bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return bag.pop();
  }

  // Leaves exactly NEXT_COUNT behind for the preview.
  function takeNext() {
    while (queue.length <= NEXT_COUNT) queue.push(nextFromBag());
    return queue.shift();
  }

  function cellsOf(p) {
    return SHAPES[p.type][p.r].map(([dx, dy]) => [p.x + dx, p.y + dy]);
  }

  // Rows above the board (y < 0) are open space, but the walls and floor are not.
  function collides(p) {
    return cellsOf(p).some(
      ([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x] !== "")
    );
  }

  function grounded() {
    return collides({ ...cur, y: cur.y + 1 });
  }

  function spawn(type) {
    cur = { type, r: 0, x: 3, y: -1 };
    landedAt = null;
    lockResets = 0;
    lastDrop = clock;
    dirty = true;
    drawMinis();

    if (collides(cur)) {
      endGame(); // blocked out: no room for the new piece
      return;
    }
    // Drop straight into view when there is room, as the guideline does.
    if (!grounded()) cur.y++;
    lowestY = cur.y;
  }

  function lock() {
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

    clearLines();
    canHold = true;
    spawn(takeNext());
    updateStats();
  }

  function clearLines() {
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (board[y].every((c) => c !== "")) {
        board.splice(y, 1);
        board.unshift(Array(COLS).fill(""));
        cleared++;
        y++;
      }
    }
    if (!cleared) return;

    lines += cleared;
    score += LINE_SCORES[cleared] * level;
    level = 1 + Math.floor(lines / 10);
    dropInterval = Math.max(80, 1000 - (level - 1) * 60);
  }

  /* -- Moves -- */

  function playing() {
    return cur !== null && !paused && !over && !suspended;
  }

  function tryMove(dx, dy) {
    const moved = { ...cur, x: cur.x + dx, y: cur.y + dy };
    if (collides(moved)) return false;
    cur = moved;
    dirty = true;
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

  function rotate(dir) {
    if (!playing() || cur.type === "O") return;
    const from = cur.r;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    const kicks = (cur.type === "I" ? KICKS.I : KICKS.JLSTZ)[`${from}>${to}`];

    for (const [kx, ky] of kicks) {
      // The kick tables have y pointing up; the board's y points down.
      const test = { ...cur, r: to, x: cur.x + kx, y: cur.y - ky };
      if (!collides(test)) {
        cur = test;
        dirty = true;
        afterMove();
        return;
      }
    }
  }

  function softDrop() {
    if (!playing() || !tryMove(0, 1)) return;
    score += 1;
    lastDrop = clock;
    afterMove();
    updateStats();
  }

  function hardDrop() {
    if (!playing()) return;
    let distance = 0;
    while (tryMove(0, 1)) distance++;
    score += distance * 2;
    lock();
    updateStats();
  }

  function holdPiece() {
    if (!playing() || !canHold) return;
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

  function reset() {
    board.forEach((row) => row.fill(""));
    bag = [];
    queue = [];
    hold = null;
    canHold = true;
    score = 0;
    lines = 0;
    level = 1;
    pieces = 0;
    dropInterval = 1000;
    paused = false;
    over = false;
    releaseAll();
    hideOverlay();
    announce("tetris:start", {});
    spawn(takeNext());
    updateStats();
    syncPauseButton();
  }

  function endGame() {
    over = true;
    paused = false;
    releaseAll();
    dirty = true;
    updateStats();
    showOverlay("over");
    syncPauseButton();
    announce("tetris:over", { score, lines, level, pieces });
  }

  function setPaused(value) {
    if (over || cur === null || paused === value) return;
    paused = value;
    releaseAll();
    if (paused) showOverlay("paused");
    else hideOverlay();
    syncPauseButton();
  }

  function showOverlay(kind) {
    if (kind === "over") {
      overlay.title.textContent = "Game over";
      overlay.sub.textContent = `Score ${score.toLocaleString()}`;
      overlay.sub.hidden = false;
      overlay.primary.textContent = "Play again";
      overlay.primary.dataset.gameAct = "reset";
      overlay.secondary.hidden = true;
      overlay.hint.textContent = "Or press R.";
      overlay.touchHint.hidden = true;
    } else {
      overlay.title.textContent = "Paused";
      overlay.sub.hidden = true;
      overlay.primary.textContent = "Resume";
      overlay.primary.dataset.gameAct = "resume";
      overlay.secondary.hidden = false;
      overlay.hint.textContent = "Press P to resume.";
      overlay.touchHint.hidden = false;
    }
    overlay.root.classList.remove("hidden");
  }

  function hideOverlay() {
    overlay.root.classList.add("hidden");
  }

  function updateStats() {
    stats.score.textContent = score.toLocaleString();
    stats.level.textContent = String(level);
    stats.lines.textContent = String(lines);
  }

  function syncPauseButton() {
    if (pauseBtn) pauseBtn.setAttribute("aria-pressed", String(paused));
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
      piece: Object.fromEntries(TYPES.map((t) => [t, token(`--piece-${t.toLowerCase()}`)])),
    };
    dirty = true;
    drawMinis();
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

  function ghostY() {
    let y = cur.y;
    while (!collides({ ...cur, y: y + 1 })) y++;
    return y;
  }

  function draw() {
    dirty = false;
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
        if (board[y][x]) paintCell(ctx, x, y, tile, palette.piece[board[y][x]]);
      }
    }

    if (cur && !over) {
      const gy = ghostY();
      if (gy !== cur.y) {
        for (const [x, y] of cellsOf({ ...cur, y: gy })) if (y >= 0) paintGhost(x, y);
      }
      for (const [x, y] of cellsOf(cur)) {
        if (y >= 0) paintCell(ctx, x, y, tile, palette.piece[cur.type]);
      }
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
    drawMini(holdCanvas, hold, !canHold);
    nextCanvases.forEach((cv, i) => drawMini(cv, queue[i], false));
    holdCanvas.setAttribute("aria-label", hold ? `Hold: ${hold} piece` : "Hold: empty");
    nextList.setAttribute("aria-label", `Next pieces: ${queue.slice(0, NEXT_COUNT).join(", ")}`);
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
      dirty = true;
    }

    for (const cv of [holdCanvas, ...nextCanvases]) setBuffer(cv, cv.clientWidth, cv.clientHeight);
    drawMinis();
  }

  /* -- Loop -- */

  function loop(ts) {
    const dt = lastFrame === null ? 0 : Math.min(ts - lastFrame, 100);
    lastFrame = ts;

    // The theme modal holds the game still, without the Paused screen.
    const modalOpen = document.body.classList.contains("modal-open");
    if (modalOpen && !suspended) releaseAll();
    suspended = modalOpen;

    if (playing()) {
      clock += dt;
      step();
    }
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

  function press(action) {
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
        reset();
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
  function typing(e) {
    return e.target instanceof Element && (e.target.closest("input, textarea, select") !== null || e.target.isContentEditable);
  }

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.body.classList.contains("modal-open") || typing(e) || meantForControl(e)) return;

    const action = actionFor(e);
    if (!action) return;
    e.preventDefault(); // arrows and Space would otherwise scroll the page
    if (e.repeat) return; // repeats come from our own timers
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

  /* -- Start -- */

  new MutationObserver(readPalette).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode", "data-color-theme"],
  });

  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(game);
  window.addEventListener("resize", fit);

  readPalette();
  fit();
  reset();
  if (document.hidden) setPaused(true);
  requestAnimationFrame(loop);
})();

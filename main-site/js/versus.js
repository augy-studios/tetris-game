// Versus: two devices on the same network play a match, paired with a six
// character code over net.js, STUN only, per STUN-p2p-spec.md.
//
// Each device plays its own board, since a piece has to answer the keys at
// once, and both are dealt the same pieces from the host's seed. The host
// runs the match: it picks the seed, starts the countdown and calls the
// result. Each sends its board to the other 20 times a second, which doubles
// as the heartbeat. Garbage travels inside those boards as a running total of
// rows sent, so a message that goes missing costs nothing: the next one
// carries the same total. script.js does the playing, through
// window.uwuTetris.
//
// Messages, beyond the spec's hello, bye, full and old:
//
//   { type: "state", v, match, phase, seed, startIn, result, board }
//                                     host to guest: the match and the host's board
//   { type: "board", match, board }   guest to host: the guest's board
//   { type: "rematch" }               guest to host: start the next match
//
// match is the match's id, 0 before the first. phase is "lobby", then
// "countdown", "playing" and "over" for each match. result is null until
// the match is over, then { winner: "host" | "guest" | null, why }. A board
// is { match, cells, cur, score, lines, sent, over }, cells a 200 character
// string of piece letters, "G" for garbage and "." for empty.

import { Host, Guest, generateCode, isValidCode, normaliseCode, CODE_LENGTH, PROTOCOL_VERSION } from "./net.js";
import { qrToSvg } from "./qr.js";
import { copyText, hydrateIcons, openModal, closeModal, isModalOpen } from "./ui.js";

const HOST_CODE_KEY = "uwutetris.hostCode";
const LAST_CODE_KEY = "uwutetris.lastCode";
// This tab's part in a session, "host" or "guest:CODE", so a reload picks
// the session up again by itself. Per tab, and gone when the tab closes.
const SESSION_KEY = "uwutetris.versus";
const SNAPSHOT_MS = 50;
const TICK_MS = 250;
const COUNTDOWN_MS = 3000;
// The guest sends its board 20 times a second, so this much silence means
// it has gone. Long enough for a host tab the browser throttles to a tick a
// second.
const HOST_SILENCE_MS = 8000;
// Time, not missed snapshots: at 20 a second a few missed ones is an
// ordinary wifi stall.
const GUEST_STALE_MS = 2000;
const MAX_ID = 2 ** 31 - 1;

const COLS = 10;
const ROWS = 20;
const CELLS = /^[.IJLOSTZG]{200}$/;
const TYPES = ["I", "J", "L", "O", "S", "T", "Z"];
const PHASES = ["lobby", "countdown", "playing", "over"];
const WINNERS = ["host", "guest", null];
const WHYS = ["topout", "left", "abandoned"];

const UNREACHABLE =
  "Could not reach the other device. Both have to be on the same network: join the same wifi, or turn on a hotspot on one and join it from the other. Check the code is still the one on screen.";

const $ = (id) => document.getElementById(id);
const game = () => window.uwuTetris;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

let role = null; // "host" | "guest" | null
let host = null;
let guest = null;
let code = "";
let problem = ""; // what went wrong, said until the next attempt
let retriedTaken = false;
let reconnects = 0;
let lastHeard = 0; // host: when the guest last spoke
let lastState = 0; // guest: when the host's state last came
let wakeLock = null;
// host: the match. guest: the host's last state.
let matchState = lobby();
let hostState = null;
let opponentBoard = null;

function lobby() {
  return { id: 0, phase: "lobby", seed: "", startAt: 0, result: null };
}

/* ---- storage ---- */

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Kept for this page view only.
  }
}

function storedCode(key) {
  const value = read(localStorage, key);
  return isValidCode(value) ? normaliseCode(value) : null;
}

/* ---- checking what arrives ---- */

// A board from the other device, rebuilt field by field so nothing
// unexpected rides along, or null if it is not one.
function cleanBoard(b) {
  if (!b || typeof b !== "object") return null;
  if (typeof b.cells !== "string" || !CELLS.test(b.cells)) return null;
  if (!isInt(b.match, 0, MAX_ID) || typeof b.over !== "boolean") return null;
  if (!isInt(b.score, 0, 1e9) || !isInt(b.lines, 0, 1e6) || !isInt(b.sent, 0, 1e6)) return null;
  let cur = null;
  if (b.cur !== null) {
    const c = b.cur;
    if (!Array.isArray(c) || c.length !== 4 || !TYPES.includes(c[0])) return null;
    if (!isInt(c[1], 0, 3) || !isInt(c[2], -3, COLS) || !isInt(c[3], -4, ROWS)) return null;
    cur = [c[0], c[1], c[2], c[3]];
  }
  return { match: b.match, cells: b.cells, cur, score: b.score, lines: b.lines, sent: b.sent, over: b.over };
}

function cleanState(s) {
  if (!isInt(s.match, 0, MAX_ID) || !PHASES.includes(s.phase)) return null;
  if (typeof s.seed !== "string" || s.seed.length > 32 || /\s/.test(s.seed)) return null;
  if (!isInt(s.startIn, 0, 10000)) return null;
  let result = null;
  if (s.result !== null) {
    if (!s.result || !WINNERS.includes(s.result.winner) || !WHYS.includes(s.result.why)) return null;
    result = { winner: s.result.winner, why: s.result.why };
  }
  const board = cleanBoard(s.board);
  if (!board) return null;
  return { match: s.match, phase: s.phase, seed: s.seed, startIn: s.startIn, result, board };
}

/* ---- the match, on either device ---- */

// "won", "lost" or "none", from this device's side.
function resultFor(winner) {
  if (winner === null) return "none";
  return winner === role ? "won" : "lost";
}

function whyText(result, why) {
  if (why === "abandoned") return "The match was called off.";
  if (why === "left") return result === "won" ? "Your opponent left the match." : "You left the match.";
  return result === "won" ? "Your opponent topped out." : "You topped out first.";
}

function applyResult(winner, why) {
  const result = resultFor(winner);
  game().setMatchResult(result, whyText(result, why));
}

// The other board, when it belongs to the match this device is playing.
function showOpponent(board) {
  opponentBoard = board;
  game().setOpponentSent(board.sent);
  game().setOpponent(board);
}

function closeVersusModal() {
  if (isModalOpen("versusModal")) closeModal("versusModal");
}

/* ---- hosting ---- */

function joinLink(c) {
  return `${location.origin}/?join=${c}`;
}

async function startHosting() {
  closeAll();
  role = "host";
  problem = "";
  write(sessionStorage, SESSION_KEY, "host");
  code = storedCode(HOST_CODE_KEY) ?? generateCode();
  write(localStorage, HOST_CODE_KEY, code);
  matchState = lobby();
  opponentBoard = null;
  game().setOpponent(null);
  $("vsCode").textContent = code;
  $("vsQr").innerHTML = qrToSvg(joinLink(code));
  $("vsCopyLabel").textContent = "Copy link";
  if (navigator.onLine === false) problem = "Playing someone nearby needs a connection to pair.";

  const mine = new Host({ maxGuests: 1 });
  host = mine;
  render();
  mine.addEventListener("status", ({ detail }) => {
    if (host !== mine) return;
    if (detail.taken && !retriedTaken) {
      // Another tab holds it, or the broker has not let go of it yet.
      retriedTaken = true;
      restartWithFreshCode();
      return;
    }
    if (detail.status === "waiting") retriedTaken = false;
    if (detail.status === "error") problem = detail.message;
    else problem = "";
    if (detail.status === "connected") {
      lastHeard = Date.now();
      acquireWakeLock();
    }
    render();
  });
  mine.addEventListener("message", ({ detail }) => {
    if (host === mine) onHostMessage(detail.message, detail.from);
  });

  try {
    await mine.start(code);
  } catch {
    if (host !== mine) return;
    host = null;
    problem = "Could not load pairing. Check your connection.";
    render();
  }
}

function restartWithFreshCode() {
  write(localStorage, HOST_CODE_KEY, null);
  startHosting();
}

function guestConnected() {
  return Boolean(host && host.links.size > 0);
}

function stateMessage() {
  const s = matchState;
  return {
    type: "state",
    v: PROTOCOL_VERSION,
    match: s.id,
    phase: s.phase,
    seed: s.seed,
    startIn: s.phase === "countdown" ? Math.max(0, s.startAt - Date.now()) : 0,
    result: s.result,
    board: game().snapshot(),
  };
}

function broadcast() {
  if (role === "host" && guestConnected()) host.send(stateMessage());
}

function startMatch() {
  if (role !== "host" || matchState.phase === "countdown" || matchState.phase === "playing") return;
  if (!guestConnected()) {
    problem = "Your opponent is not connected.";
    render();
    return;
  }
  const [id] = crypto.getRandomValues(new Uint32Array(1));
  matchState = {
    id: 1 + (id % (MAX_ID - 1)),
    phase: "countdown",
    seed: game().newSeed(),
    startAt: Date.now() + COUNTDOWN_MS,
    result: null,
  };
  problem = "";
  opponentBoard = null;
  game().setOpponent(null);
  game().startMatch(matchState.id, matchState.seed, COUNTDOWN_MS);
  closeVersusModal();
  broadcast();
  render();
}

function finishMatch(winner, why) {
  if (matchState.phase !== "countdown" && matchState.phase !== "playing") return;
  matchState.phase = "over";
  matchState.result = { winner, why };
  applyResult(winner, why);
  broadcast();
  render();
}

function onHostMessage(message, from) {
  lastHeard = Date.now();
  switch (message.type) {
    case "hello":
      if (message.v !== PROTOCOL_VERSION) {
        host.send({ type: "old", v: PROTOCOL_VERSION }, from);
        return;
      }
      host.send(stateMessage(), from);
      render();
      return;
    case "board": {
      const board = cleanBoard(message.board);
      if (board) onGuestBoard(board);
      return;
    }
    case "rematch":
      startMatch();
      return;
    case "bye":
      // Leaving on purpose: the match is the host's, and this code is spent.
      finishMatch("host", "left");
      restartWithFreshCode();
      return;
    default:
      // Anything this build does not know: ignored, never thrown on.
      return;
  }
}

function onGuestBoard(board) {
  const s = matchState;
  if (board.match !== s.id || !s.id) {
    // Playing, and the guest is not: it reloaded and lost its board.
    if (s.phase === "playing") finishMatch(null, "abandoned");
    return;
  }
  showOpponent(board);
  if (board.over) finishMatch("host", "topout");
}

/* ---- joining ---- */

async function join(input) {
  const c = normaliseCode(input);
  if (!isValidCode(c)) {
    problem = `A code is ${CODE_LENGTH} characters.`;
    render();
    $("vsJoinInput").focus();
    return;
  }
  if (role !== "guest" || code !== c) reconnects = 0;
  closeAll();
  role = "guest";
  code = c;
  problem = navigator.onLine === false ? "Playing someone nearby needs a connection to pair." : "";
  hostState = null;
  lastState = 0;
  write(sessionStorage, SESSION_KEY, `guest:${c}`);

  const mine = new Guest();
  guest = mine;
  render();
  mine.addEventListener("status", ({ detail }) => {
    if (guest === mine) onGuestStatus(detail);
  });
  mine.addEventListener("message", ({ detail }) => {
    if (guest === mine) onGuestMessage(detail.message);
  });

  try {
    await mine.connect(c);
    write(localStorage, LAST_CODE_KEY, c);
  } catch {
    if (guest !== mine) return;
    guest = null;
    problem = "Could not load pairing. Check your connection.";
    render();
  }
}

function onGuestStatus({ status, message }) {
  if (status === "connected") {
    reconnects = 0;
    problem = "";
    acquireWakeLock();
  } else if (status === "dropped") {
    // Probably coming back: try again quietly a few times.
    if (reconnects < 3) {
      reconnects++;
      setTimeout(() => role === "guest" && guest?.status === "dropped" && join(code), 1500);
    } else {
      problem = "The connection dropped.";
    }
  } else if (status === "unreachable") {
    problem = UNREACHABLE;
  } else if (status === "error") {
    problem = message;
  }
  render();
}

function onGuestMessage(message) {
  switch (message.type) {
    case "state": {
      const s = cleanState(message);
      if (!s) return;
      lastState = Date.now();
      hostState = s;
      followHost(s);
      render();
      return;
    }
    case "full":
      problem = "That match already has two players.";
      render();
      return;
    case "old":
      problem = "The host's device is on a different version. Reload both and try again.";
      render();
      return;
    default:
      return;
  }
}

function followHost(s) {
  const g = game();
  if (s.phase === "countdown" && g.matchId() !== s.match) {
    g.startMatch(s.match, s.seed, s.startIn);
    opponentBoard = null;
    closeVersusModal();
  }
  const mine = g.matchId();
  if (mine !== s.match) {
    // The host moved on, or reloaded and forgot the match.
    if (mine) g.setMatchResult("none", whyText("none", "abandoned"));
    return;
  }
  showOpponent(s.board);
  if (s.phase === "over" && s.result) applyResult(s.result.winner, s.result.why);
}

/* ---- both ---- */

function closeAll() {
  host?.close();
  host = null;
  guest?.close();
  guest = null;
}

function leave() {
  if (role === "host") {
    host?.close();
    host = null;
  } else if (role === "guest") {
    guest?.leave();
    guest = null;
    write(localStorage, LAST_CODE_KEY, null);
  }
  role = null;
  problem = "";
  hostState = null;
  matchState = lobby();
  opponentBoard = null;
  write(sessionStorage, SESSION_KEY, null);
  releaseWakeLock();
  game().endVersus();
  render();
}

// Asked for by Rematch, R or Play again on the game over screen, in a session.
function onRematch() {
  if (role === "host") startMatch();
  else if (role === "guest" && guest?.status === "connected") guest.send({ type: "rematch" });
}

// The host's own board topping out ends the match.
function onGameOver(event) {
  if (role !== "host" || !event.detail.match || event.detail.match !== matchState.id) return;
  finishMatch("guest", "topout");
}

// { tone, long, short }: the modal's line and the opponent card's.
function statusLine() {
  if (role === "host") {
    if (!host) return { tone: "error", long: problem || "Not hosting.", short: "Not connected" };
    if (problem) return { tone: "error", long: problem, short: "Problem" };
    // idle: still loading PeerJS, before it says connecting.
    if (host.status === "idle" || host.status === "connecting") {
      return { tone: "busy", long: "Setting up the code.", short: "Setting up" };
    }
    if (!guestConnected()) {
      return matchState.phase === "playing"
        ? { tone: "warn", long: `Your opponent disconnected. They can rejoin with ${code}.`, short: "Opponent disconnected" }
        : { tone: "busy", long: "Waiting for the other device. Share the code, the link or the QR code.", short: `Waiting, code ${code}` };
    }
    return { tone: "ok", long: phaseText(matchState.phase, true), short: "Connected" };
  }
  if (role === "guest") {
    if (problem) return { tone: "error", long: problem, short: "Problem" };
    const status = guest?.status;
    if (status === "connected" && Date.now() - lastState < GUEST_STALE_MS) {
      return { tone: "ok", long: phaseText(hostState?.phase ?? "lobby", false), short: "Connected" };
    }
    if (status === "connected") return { tone: "warn", long: "The connection looks stale.", short: "Connection stale" };
    if (status === "idle" || status === "connecting" || status === "dropped") {
      return { tone: "busy", long: `Connecting to ${code}.`, short: "Connecting" };
    }
    return { tone: "error", long: "Not connected.", short: "Not connected" };
  }
  return { tone: "busy", long: "", short: "" };
}

function phaseText(phase, hosting) {
  switch (phase) {
    case "countdown":
      return "Starting.";
    case "playing":
      return "Playing.";
    case "over":
      return hosting ? "Connected. Start the next match when you are both ready." : "Connected. Rematch, or wait for the host.";
    default:
      return hosting ? "Connected. Start the match when you are both ready." : "Connected. Waiting for the host to start the match.";
  }
}

const put = (el, text) => {
  if (el.textContent !== text) el.textContent = text;
};

function render() {
  const line = statusLine();
  const status = $("vsStatus");
  put(status, line.long);
  status.dataset.tone = line.tone;

  const hosting = role === "host";
  const live = matchState.phase === "countdown" || matchState.phase === "playing";
  $("vsChoose").hidden = role !== null;
  $("vsHostView").hidden = !hosting;
  $("vsStartBtn").hidden = !(hosting && guestConnected() && !live);
  put($("vsStartBtn"), matchState.id ? "Start the next match" : "Start the match");
  $("vsRetryBtn").hidden = !(role === "guest" && problem && guest?.status !== "connected");
  $("vsLeaveBtn").hidden = role === null;
  put($("vsLeaveBtn"), hosting ? "Stop hosting" : "Leave");

  document.body.classList.toggle("versus", role !== null);
  $("oppCard").hidden = role === null;
  $("oppStatus").dataset.tone = line.tone;
  put($("oppStatusText"), line.short);
  const b = opponentBoard;
  put($("oppInfo"), b ? `Score ${b.score.toLocaleString()}, ${b.lines} ${b.lines === 1 ? "line" : "lines"}` : "Waiting for a match");
}

/* ---- the screen ---- */

async function acquireWakeLock() {
  try {
    if (!wakeLock && "wakeLock" in navigator && document.visibilityState === "visible") {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener("release", () => {
        wakeLock = null;
      });
    }
  } catch {
    // Refused or unsupported: the screen may sleep, nothing else changes.
  }
}

function releaseWakeLock() {
  wakeLock?.release().catch(() => {});
  wakeLock = null;
}

function tick() {
  if (role === "host" && host) {
    // A guest silent this long has probably gone; its seat reopens.
    if (guestConnected() && Date.now() - lastHeard > HOST_SILENCE_MS) host.dropAll();
    if (matchState.phase === "countdown" && Date.now() >= matchState.startAt) matchState.phase = "playing";
  }
  if (role) render();
}

// The steady beat both ways, which doubles as each end's heartbeat.
function beat() {
  if (role === "host") broadcast();
  else if (role === "guest" && guest?.status === "connected") {
    guest.send({ type: "board", match: game().matchId(), board: game().snapshot() });
  }
}

export function openVersus() {
  if (role === "guest" || !role) {
    const field = $("vsJoinInput");
    if (!field.value) field.value = code || storedCode(LAST_CODE_KEY) || "";
  }
  render();
  openModal("versusModal");
}

// joinCode is from a join link (?join=CODE): the modal opens and joins it.
export function initVersus({ joinCode } = {}) {
  $("versusBtn").addEventListener("click", openVersus);
  $("vsHostBtn").addEventListener("click", startHosting);
  $("vsJoinForm").addEventListener("submit", (e) => {
    e.preventDefault();
    join($("vsJoinInput").value);
  });
  $("vsJoinInput").addEventListener("input", (e) => {
    const c = normaliseCode(e.target.value);
    if (c !== e.target.value) e.target.value = c;
  });
  $("vsCopyLink").addEventListener("click", async () => {
    $("vsCopyLabel").textContent = (await copyText(joinLink(code))) ? "Copied" : "Copy failed";
  });
  $("vsNewCode").addEventListener("click", () => {
    if (role === "host") restartWithFreshCode();
  });
  $("vsStartBtn").addEventListener("click", startMatch);
  $("vsRetryBtn").addEventListener("click", () => join(code));
  $("vsLeaveBtn").addEventListener("click", leave);

  document.addEventListener("tetris:rematch", onRematch);
  document.addEventListener("tetris:over", onGameOver);

  setInterval(beat, SNAPSHOT_MS);
  setInterval(tick, TICK_MS);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (role === "host" ? guestConnected() : guest?.status === "connected") acquireWakeLock();
    // Back from the background with a channel that died meanwhile.
    if (role === "guest" && guest?.status === "dropped") join(code);
  });

  hydrateIcons($("versusModal"));

  // A join link, then this tab's session from before a reload.
  const linked = normaliseCode(joinCode);
  const session = read(sessionStorage, SESSION_KEY) ?? "";
  if (linked) {
    $("vsJoinInput").value = linked;
    openVersus();
    join(linked);
  } else if (session === "host") {
    startHosting();
  } else if (session.startsWith("guest:") && isValidCode(session.slice(6))) {
    join(session.slice(6));
  }
}

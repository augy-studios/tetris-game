// Versus: up to eight devices on the same network play a match, paired with
// a six character code over net.js, STUN only, per STUN-p2p-spec.md.
//
// Each device plays its own board, since a piece has to answer the keys at
// once, and all are dealt the same pieces from the host's seed. The host
// runs the match: it seats the players, picks the seed, starts the countdown
// and calls the result, the last one standing. Each guest sends its board to
// the host 20 times a second, and the host sends every board to every guest
// as often, which doubles as the heartbeat. Garbage travels inside those
// boards as a running total of rows sent to each seat, so a message that goes
// missing costs nothing: the next one carries the same totals. script.js does
// the playing, through window.uwuTetris.
//
// Messages, beyond the spec's hello, bye, full and old:
//
//   { type: "state", v, match, phase, seed, startIn, result, you, seats, out, players }
//                                     host to guest: the match and every board
//   { type: "board", match, board }   guest to host: the guest's board
//   { type: "rematch" }               guest to host: start the next match
//
// A guest joins with { player } in its link's metadata, a stable id for the
// tab, so one that drops and comes back keeps its seat. Seats are 0 to 7,
// the host's 0; you is the guest's own. match is the
// match's id, 0 before the first. phase is "lobby", then "countdown",
// "playing" and "over" for each match. seats are the match's players and out
// those of them knocked out, in order. result is null until the match is
// over, then { winner: seat | null, why }. players is everyone in the
// session, [{ seat, on, board }], on false while a guest is away and board
// null until its first has come. A board is { match, cells, cur, score,
// lines, sent, over }, cells a 200 character string of piece letters, "G" for
// garbage and "." for empty, and sent the rows sent to each seat.

import { Host, Guest, generateCode, isValidCode, normaliseCode, CODE_LENGTH, PROTOCOL_VERSION } from "./net.js";
import { qrToSvg } from "./qr.js";
import { copyText, hydrateIcons, openModal, closeModal, isModalOpen } from "./ui.js";

const HOST_CODE_KEY = "uwutetris.hostCode";
const LAST_CODE_KEY = "uwutetris.lastCode";
// This tab's part in a session, "host" or "guest:CODE", so a reload picks
// the session up again by itself. Per tab, and gone when the tab closes.
const SESSION_KEY = "uwutetris.versus";
// This tab's id as a guest, per tab like the session, so two tabs on one
// device are two players.
const PLAYER_KEY = "uwutetris.player";
const MAX_PLAYERS = 8; // the host and seven guests
const SNAPSHOT_MS = 50;
const TICK_MS = 250;
const COUNTDOWN_MS = 3000;
// A guest sends its board 20 times a second, so this much silence means it
// has gone. Long enough for a host tab the browser throttles to a tick a
// second.
const HOST_SILENCE_MS = 8000;
// Time, not missed snapshots: at 20 a second a few missed ones is an
// ordinary wifi stall.
const GUEST_STALE_MS = 2000;
const MAX_ID = 2 ** 31 - 1;

const COLS = 10;
const ROWS = 20;
const CELLS = /^[.IJLOSTZG]{200}$/;
const PLAYER_ID = /^[A-Za-z0-9]{1,32}$/;
const TYPES = ["I", "J", "L", "O", "S", "T", "Z"];
const PHASES = ["lobby", "countdown", "playing", "over"];
const WHYS = ["topout", "left", "abandoned"];

const UNREACHABLE =
  "Could not reach the host's device. Every device has to be on the same network: join the same wifi, or turn on a hotspot on one and join it from the others. Check the code is still the one on screen.";

const $ = (id) => document.getElementById(id);
const game = () => window.uwuTetris;
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isSeat = (v) => isInt(v, 0, MAX_PLAYERS - 1);

let role = null; // "host" | "guest" | null
let host = null;
let guest = null;
let code = "";
let problem = ""; // what went wrong, said until the next attempt
let retriedTaken = false;
let reconnects = 0;
let lastState = 0; // guest: when the host's state last came
let wakeLock = null;
// host: the match, and the guests by seat: { id, peer, board, heard }, peer
// null while one is away. guest: the host's last state.
let matchState = lobby();
let seats = new Map();
let hostState = null;

function lobby() {
  return { id: 0, phase: "lobby", seed: "", startAt: 0, result: null, seats: [], out: [] };
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

let playerId = "";

function myPlayerId() {
  if (playerId) return playerId;
  const stored = read(sessionStorage, PLAYER_KEY);
  if (stored && PLAYER_ID.test(stored)) return (playerId = stored);
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  playerId = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  write(sessionStorage, PLAYER_KEY, playerId);
  return playerId;
}

/* ---- checking what arrives ---- */

// Distinct seats, at most all of them, or null.
function cleanSeats(list) {
  if (!Array.isArray(list) || list.length > MAX_PLAYERS || !list.every(isSeat)) return null;
  return new Set(list).size === list.length ? [...list] : null;
}

// A board from another device, rebuilt field by field so nothing unexpected
// rides along, or null if it is not one.
function cleanBoard(b) {
  if (!b || typeof b !== "object") return null;
  if (typeof b.cells !== "string" || !CELLS.test(b.cells)) return null;
  if (!isInt(b.match, 0, MAX_ID) || typeof b.over !== "boolean") return null;
  if (!isInt(b.score, 0, 1e9) || !isInt(b.lines, 0, 1e6)) return null;
  if (!Array.isArray(b.sent) || b.sent.length !== MAX_PLAYERS || !b.sent.every((n) => isInt(n, 0, 1e6))) return null;
  let cur = null;
  if (b.cur !== null) {
    const c = b.cur;
    if (!Array.isArray(c) || c.length !== 4 || !TYPES.includes(c[0])) return null;
    if (!isInt(c[1], 0, 3) || !isInt(c[2], -3, COLS) || !isInt(c[3], -4, ROWS)) return null;
    cur = [c[0], c[1], c[2], c[3]];
  }
  return { match: b.match, cells: b.cells, cur, score: b.score, lines: b.lines, sent: [...b.sent], over: b.over };
}

function cleanState(s) {
  if (!isInt(s.match, 0, MAX_ID) || !PHASES.includes(s.phase) || !isSeat(s.you)) return null;
  if (typeof s.seed !== "string" || s.seed.length > 32 || /\s/.test(s.seed)) return null;
  if (!isInt(s.startIn, 0, 10000)) return null;
  let result = null;
  if (s.result !== null) {
    const r = s.result;
    if (!r || !(r.winner === null || isSeat(r.winner)) || !WHYS.includes(r.why)) return null;
    result = { winner: r.winner, why: r.why };
  }
  const inMatch = cleanSeats(s.seats);
  const out = cleanSeats(s.out);
  if (!inMatch || !out) return null;
  if (!Array.isArray(s.players) || !s.players.length || s.players.length > MAX_PLAYERS) return null;
  const players = [];
  for (const p of s.players) {
    if (!p || !isSeat(p.seat) || typeof p.on !== "boolean") return null;
    if (players.some((q) => q.seat === p.seat)) return null;
    const board = p.board === null ? null : cleanBoard(p.board);
    if (p.board !== null && !board) return null;
    players.push({ seat: p.seat, on: p.on, board });
  }
  return {
    match: s.match,
    phase: s.phase,
    seed: s.seed,
    startIn: s.startIn,
    result,
    you: s.you,
    seats: inMatch,
    out,
    players,
  };
}

/* ---- the match, on any device ---- */

// This device's seat: the host's is 0.
function mySeat() {
  return role === "guest" ? (hostState?.you ?? -1) : 0;
}

// "won", "lost" or "none", from this device's side.
function resultFor(winner) {
  if (winner === null) return "none";
  return winner === mySeat() ? "won" : "lost";
}

// many: more than two in the match.
function whyText(result, why, winner, many) {
  if (why === "abandoned" || winner === null) return "The match was called off.";
  if (many) return result === "won" ? "You were the last one standing." : `Player ${winner + 1} was the last one standing.`;
  if (why === "left") return result === "won" ? "Your opponent left the match." : "You left the match.";
  return result === "won" ? "Your opponent topped out." : "You topped out first.";
}

function applyResult({ winner, why }, many) {
  const result = resultFor(winner);
  game().setMatchResult(result, whyText(result, why, winner, many));
}

// The other boards, for script.js to draw and take garbage from: everyone in
// the session but this device, in seat order.
function showOpponents(players, out) {
  const me = mySeat();
  game().setOpponents(
    players
      .filter((p) => p.seat !== me)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({ ...p.board, seat: p.seat, away: !p.on, out: out.includes(p.seat) })),
  );
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
  seats = new Map();
  game().setOpponents([]);
  $("vsCode").textContent = code;
  $("vsQr").innerHTML = qrToSvg(joinLink(code));
  $("vsCopyLabel").textContent = "Copy link";
  if (navigator.onLine === false) problem = "Playing someone nearby needs a connection to pair.";

  const mine = new Host({ maxGuests: MAX_PLAYERS - 1 });
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
    if (detail.status === "connected") acquireWakeLock();
    render();
  });
  mine.addEventListener("message", ({ detail }) => {
    if (host === mine) onHostMessage(detail.message, detail.from);
  });
  mine.addEventListener("leave", ({ detail }) => {
    if (host !== mine) return;
    const seat = seatOf(detail.id);
    if (seat) unseat(seat);
    render();
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

const live = () => matchState.phase === "countdown" || matchState.phase === "playing";

// The seat a peer sits in, or 0 when it has none (0 is the host's own).
function seatOf(peer) {
  for (const [seat, p] of seats) if (p.peer === peer) return seat;
  return 0;
}

// The seat for a guest saying hello: its old one when it is coming back,
// otherwise the lowest free, or null when there is none.
function seatGuest(id, peer) {
  for (const [seat, p] of seats) {
    if (p.id !== id && p.peer !== peer) continue;
    p.peer = peer;
    p.heard = Date.now();
    return seat;
  }
  for (let seat = 1; seat < MAX_PLAYERS; seat++) {
    if (seats.has(seat)) continue;
    seats.set(seat, { id, peer, board: null, heard: Date.now() });
    return seat;
  }
  return null;
}

// A guest gone away. Its seat is kept while the match it is in is played,
// so it can come back to its board; otherwise it is freed.
function unseat(seat) {
  const p = seats.get(seat);
  if (!p) return;
  p.peer = null;
  if (!(live() && matchState.seats.includes(seat) && !matchState.out.includes(seat))) seats.delete(seat);
}

// Guests here now, seated.
function guestsOn() {
  return [...seats.values()].filter((p) => p.peer).length;
}

function broadcast() {
  if (role !== "host" || !host || !guestsOn()) return;
  const s = matchState;
  const players = [{ seat: 0, on: true, board: game().snapshot() }];
  for (const [seat, p] of seats) players.push({ seat, on: Boolean(p.peer), board: p.board });
  const base = {
    type: "state",
    v: PROTOCOL_VERSION,
    match: s.id,
    phase: s.phase,
    seed: s.seed,
    startIn: s.phase === "countdown" ? Math.max(0, s.startAt - Date.now()) : 0,
    result: s.result,
    seats: s.seats,
    out: s.out,
    players,
  };
  for (const [seat, p] of seats) if (p.peer) host.send({ ...base, you: seat }, p.peer);
}

function startMatch() {
  if (role !== "host" || live()) return;
  if (!guestsOn()) {
    problem = "Nobody else is connected.";
    render();
    return;
  }
  // Those away when the last match ended give their seats up now.
  for (const [seat, p] of seats) if (!p.peer) seats.delete(seat);
  const [id] = crypto.getRandomValues(new Uint32Array(1));
  matchState = {
    id: 1 + (id % (MAX_ID - 1)),
    phase: "countdown",
    seed: game().newSeed(),
    startAt: Date.now() + COUNTDOWN_MS,
    result: null,
    seats: [0, ...[...seats.keys()].sort((a, b) => a - b)],
    out: [],
  };
  problem = "";
  game().startMatch(matchState.id, matchState.seed, COUNTDOWN_MS, 0);
  showOpponents(hostPlayers(), matchState.out);
  closeVersusModal();
  broadcast();
  render();
}

// A player of the match out of it. The match ends when one is left.
function knockOut(seat, why) {
  const s = matchState;
  if (!live() || !s.seats.includes(seat) || s.out.includes(seat)) return;
  s.out.push(seat);
  const left = s.seats.filter((x) => !s.out.includes(x));
  if (left.length <= 1) finishMatch(left[0] ?? null, why);
  else broadcast();
}

function finishMatch(winner, why) {
  if (!live()) return;
  matchState.phase = "over";
  matchState.result = { winner, why };
  applyResult(matchState.result, matchState.seats.length > 2);
  for (const [seat, p] of seats) if (!p.peer) seats.delete(seat);
  broadcast();
  render();
}

function onHostMessage(message, from) {
  if (message.type === "hello") {
    if (message.v !== PROTOCOL_VERSION) {
      host.send({ type: "old", v: PROTOCOL_VERSION }, from);
      return;
    }
    const player = host.links.get(from)?.metadata?.player;
    const id = typeof player === "string" && PLAYER_ID.test(player) ? player : from;
    if (seatGuest(id, from) === null) {
      // Every seat is held, some by players of the match who are away.
      host.send({ type: "full" }, from);
      setTimeout(() => host?.dropGuest(from), 500);
      return;
    }
    broadcast();
    render();
    return;
  }

  const seat = seatOf(from);
  if (!seat) return; // not seated: it has not said hello
  seats.get(seat).heard = Date.now();
  switch (message.type) {
    case "board": {
      const board = cleanBoard(message.board);
      if (board) onGuestBoard(seat, board);
      return;
    }
    case "rematch":
      startMatch();
      return;
    case "bye":
      // Leaving on purpose: out of the match, and the seat is free.
      knockOut(seat, "left");
      seats.delete(seat);
      // The last guest gone: this code is spent.
      if (![...host.links.keys()].some((id) => id !== from)) restartWithFreshCode();
      else render();
      return;
    default:
      // Anything this build does not know: ignored, never thrown on.
      return;
  }
}

function onGuestBoard(seat, board) {
  seats.get(seat).board = board;
  const s = matchState;
  if (!s.seats.includes(seat)) return;
  if (board.match !== s.id) {
    // Playing, and this guest is not: it reloaded and lost its board.
    if (s.phase === "playing") knockOut(seat, "left");
    return;
  }
  if (board.over) knockOut(seat, "topout");
}

// The guests as the state message has them, for the host's own card.
function hostPlayers() {
  return [...seats].map(([seat, p]) => ({ seat, on: Boolean(p.peer), board: p.board }));
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
    await mine.connect(c, { player: myPlayerId() });
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
      // Closed here, so the host closing the link is not retried as a drop.
      guest?.close();
      problem = `That match already has ${MAX_PLAYERS} players.`;
      render();
      return;
    case "old":
      problem = "The host's device is on a different version. Reload every device and try again.";
      render();
      return;
    default:
      return;
  }
}

function followHost(s) {
  const g = game();
  if (s.phase === "countdown" && g.matchId() !== s.match && s.seats.includes(s.you)) {
    g.startMatch(s.match, s.seed, s.startIn, s.you);
    closeVersusModal();
  }
  // Drawn whether or not this device is in the match: one that joined
  // during it watches.
  showOpponents(s.players, s.out);
  const mine = g.matchId();
  if (mine !== s.match) {
    // The host moved on, or reloaded and forgot the match.
    if (mine) g.setMatchResult("none", whyText("none", "abandoned", null, false));
    return;
  }
  if (s.phase === "over" && s.result) applyResult(s.result, s.seats.length > 2);
}

/* ---- every device ---- */

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
    seats = new Map();
  } else if (role === "guest") {
    guest?.leave();
    guest = null;
    write(localStorage, LAST_CODE_KEY, null);
  }
  role = null;
  problem = "";
  hostState = null;
  matchState = lobby();
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

// The host's own board topping out puts it out of the match.
function onGameOver(event) {
  if (role !== "host" || !event.detail.match || event.detail.match !== matchState.id) return;
  knockOut(0, "topout");
}

// "Player 3", "Players 3 and 5", "Players 2, 3 and 5".
function playerNames(list) {
  const n = list.map((seat) => seat + 1);
  if (n.length === 1) return `Player ${n[0]}`;
  return `Players ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

// { tone, long, short }: the modal's line and the opponents' card's.
function statusLine() {
  if (role === "host") {
    if (!host) return { tone: "error", long: problem || "Not hosting.", short: "Not connected" };
    if (problem) return { tone: "error", long: problem, short: "Problem" };
    // idle: still loading PeerJS, before it says connecting.
    if (host.status === "idle" || host.status === "connecting") {
      return { tone: "busy", long: "Setting up the code.", short: "Setting up" };
    }
    const s = matchState;
    const away = live() ? s.seats.filter((seat) => seat && !s.out.includes(seat) && !seats.get(seat)?.peer) : [];
    if (away.length) {
      const who = s.seats.length === 2 ? "Your opponent" : playerNames(away);
      return {
        tone: "warn",
        long: `${who} disconnected. They can rejoin with ${code}.`,
        short: `${who} disconnected`,
      };
    }
    if (!guestsOn()) {
      return { tone: "busy", long: "Waiting for other devices. Share the code, the link or the QR code.", short: `Waiting, code ${code}` };
    }
    const count = guestsOn() + 1;
    return { tone: "ok", long: phaseText(s.phase, true, count), short: `${count} players` };
  }
  if (role === "guest") {
    if (problem) return { tone: "error", long: problem, short: "Problem" };
    const status = guest?.status;
    if (status === "connected" && hostState && Date.now() - lastState < GUEST_STALE_MS) {
      return {
        tone: "ok",
        long: `You are player ${hostState.you + 1}. ${phaseText(hostState.phase, false, hostState.players.length)}`,
        short: `Player ${hostState.you + 1}`,
      };
    }
    if (status === "connected" && hostState) return { tone: "warn", long: "The connection looks stale.", short: "Connection stale" };
    if (status === "idle" || status === "connecting" || status === "dropped" || status === "connected") {
      return { tone: "busy", long: `Connecting to ${code}.`, short: "Connecting" };
    }
    return { tone: "error", long: "Not connected.", short: "Not connected" };
  }
  return { tone: "busy", long: "", short: "" };
}

function phaseText(phase, hosting, count) {
  const ready = count > 2 ? "everyone is ready" : "you are both ready";
  switch (phase) {
    case "countdown":
      return "Starting.";
    case "playing":
      return "Playing.";
    case "over":
      return hosting ? `${count} players. Start the next match when ${ready}.` : "Rematch, or wait for the host.";
    default:
      return hosting ? `${count} players. Start the match when ${ready}.` : "Waiting for the host to start the match.";
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
  $("vsChoose").hidden = role !== null;
  $("vsHostView").hidden = !hosting;
  $("vsStartBtn").hidden = !(hosting && guestsOn() && !live());
  put($("vsStartBtn"), matchState.id ? "Start the next match" : "Start the match");
  $("vsRetryBtn").hidden = !(role === "guest" && problem && guest?.status !== "connected");
  $("vsLeaveBtn").hidden = role === null;
  put($("vsLeaveBtn"), hosting ? "Stop hosting" : "Leave");

  document.body.classList.toggle("versus", role !== null);
  $("oppCard").hidden = role === null;
  $("oppStatus").dataset.tone = line.tone;
  put($("oppStatusText"), line.short);
  // The boards and their scores are script.js's to draw: in a replay it
  // shows them as they were, not as they are.
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
    // A guest silent this long has probably gone; its seat reopens, or
    // waits for it while its match is played.
    const now = Date.now();
    for (const [seat, p] of seats) {
      if (!p.peer || now - p.heard <= HOST_SILENCE_MS) continue;
      host.dropGuest(p.peer);
      unseat(seat);
    }
    if (matchState.phase === "countdown" && now >= matchState.startAt) matchState.phase = "playing";
  }
  if (role) render();
}

// The steady beat both ways, which doubles as each end's heartbeat.
function beat() {
  if (role === "host") {
    broadcast();
    if (host) showOpponents(hostPlayers(), matchState.out);
  } else if (role === "guest" && guest?.status === "connected") {
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
    if (role === "host" ? guestsOn() : guest?.status === "connected") acquireWakeLock();
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

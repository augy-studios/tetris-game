// Ranked games. script.js announces each game's start and end; this asks the
// server for a game id at the start, sends the final numbers at game over,
// and runs the name form on the game over screen.

import { api } from "./api.js";
import { openLeaderboard } from "./leaderboard.js";
import { getSettings, saveSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString();

// Refusals that no retry will change.
const FINAL = new Set(["implausible", "outdated","already_finished", "already_submitted", "expired", "not_found", "no_score"]);

// The game on screen: { id: Promise<string | null>, startError, stats, finished }.
let current = null;

function say(text) {
  $("rankMsg").textContent = text;
}

function showForm(visible) {
  $("submitForm").hidden = !visible;
  $("submitBtn").disabled = false;
}

function onStart() {
  $("rankArea").hidden = true;
  const game = { startError: null, stats: null, finished: null };
  // Offline, or the API down: the game still plays, unranked.
  game.id = api.newGame().then(
    (r) => r.game_id,
    (err) => {
      game.startError = err;
      return null;
    }
  );
  current = game;
}

// Sent once. A dropped connection or a server error may be retried; the
// server's refusals stand.
function finish(game) {
  game.finished ??= game.id
    .then((id) => api.finish(id, game.stats))
    .catch((err) => {
      if (!FINAL.has(err.code)) game.finished = null;
      throw err;
    });
  return game.finished;
}

async function onOver(event) {
  const game = current;
  if (!game) return;
  const { assisted, ...stats } = event.detail;
  game.stats = stats;

  const prefs = getSettings();
  $("rankArea").hidden = false;
  $("nameInput").value = prefs.name ?? "";
  showForm(false);
  say("");

  if (assisted) {
    say("Autoplay was used this session, so this game is not ranked.");
    return;
  }

  const id = await game.id;
  if (game !== current) return;
  if (!id) {
    say(
      game.startError?.code === "offline"
        ? "Played offline, so this game is not ranked."
        : "The leaderboard was out of reach when this game started, so it is not ranked."
    );
    return;
  }
  if (game.stats.score <= 0) {
    say("Score some points to go on the leaderboard.");
    return;
  }

  try {
    await finish(game);
  } catch (err) {
    if (game !== current) return;
    if (FINAL.has(err.code)) {
      say(err.message || "This game could not be ranked.");
      return;
    }
    // Lost the connection at the last moment: offer the form, and submitting
    // sends the numbers again first.
  }
  if (game !== current) return;

  if (prefs.auto_submit && prefs.name) submitAs(game, prefs.name, true);
  else showForm(true);
}

// Adds the game under a name, typed or saved. Any name that goes through
// becomes the saved one.
async function submitAs(game, name, auto = false) {
  showForm(!auto);
  $("submitBtn").disabled = true;
  say(auto ? `Adding as ${name}.` : "");
  try {
    await finish(game);
    const r = await api.submit(await game.id, name);
    saveSettings({ name: r.name });
    if (game !== current) return;
    const games = r.games === 1 ? "1 game" : `${fmt(r.games)} games`;
    say(
      `Added as ${r.name}. Best score ${fmt(r.best_score)}, ranked ${r.rank}. ` +
        `Total ${fmt(r.total)} over ${games}, ranked ${r.total_rank}.`
    );
    showForm(false);
  } catch (err) {
    if (game !== current) return;
    if (err.code === "offline") say("No connection. Try again once you are back online.");
    else if (auto && err.status === 400) say("Your saved name was refused, so this game was not added. Change it in Settings.");
    else if (auto && !FINAL.has(err.code)) say("This game could not be added automatically. Try the button.");
    else say(err.message || "That did not go through. Try again in a moment.");
    showForm(!FINAL.has(err.code));
  }
}

function onSubmit(event) {
  event.preventDefault();
  const name = $("nameInput").value.trim();
  if (!name) {
    say("Enter a name.");
    $("nameInput").focus();
    return;
  }
  if (current) submitAs(current, name);
}

export function initRanked() {
  document.addEventListener("tetris:start", onStart);
  document.addEventListener("tetris:over", onOver);
  $("submitForm").addEventListener("submit", onSubmit);
  $("overlayBoardBtn").addEventListener("click", () => openLeaderboard());
}

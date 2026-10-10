// Full screen, from the topbar's button or F. In full screen the brand goes
// and the topbar's buttons become sg-psi's floating tray: a glass column top
// right with an arrow tab beside it, which slides off the right edge to leave
// the board the room. The tray is open until somebody closes it; that choice
// is a per-browser convenience, so storage failing only means it opens again
// next time.
//
// The manifest no longer launches the installed app full screen, because a
// launch-time full screen cannot be left from the page. An install made before
// that change may still run that way until the browser picks up the new
// manifest; it gets the tray too, but no button: there is no full screen to leave.

import { hydrateIcons } from "./ui.js";

const TRAY_KEY = "uwutetris.trayOpen";

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const appFullscreen = matchMedia("(display-mode: fullscreen)");

function element() {
  return document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
}

// iPhone Safari has no full screen for a page, only for video.
function supported() {
  return Boolean(document.fullscreenEnabled ?? document.webkitFullscreenEnabled);
}

async function toggle() {
  try {
    if (element()) await (document.exitFullscreen ?? document.webkitExitFullscreen).call(document);
    else if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: "hide" });
    else root.webkitRequestFullscreen?.();
  } catch {
    // Refused, say outside a click: nothing changes.
  }
}

function setTray(open, { save = true } = {}) {
  $("tray").classList.toggle("collapsed", !open);
  $("trayTab").setAttribute("aria-expanded", String(open));
  $("trayTab").setAttribute("aria-label", open ? "Hide menu" : "Show menu");
  document.body.classList.toggle("tray-open", open);
  sync();
  if (!save) return;
  try {
    localStorage.setItem(TRAY_KEY, open ? "1" : "0");
  } catch {
    // Remembered for this page view only.
  }
}

// The page's look for whether it is full screen now.
function sync() {
  const full = Boolean(element()) || appFullscreen.matches;
  const open = !$("tray").classList.contains("collapsed");
  document.body.classList.toggle("fullscreen", full);
  // Off screen buttons must not take focus.
  $("trayButtons").inert = full && !open;

  const btn = $("fullscreenBtn");
  btn.hidden = !supported() || (appFullscreen.matches && !element());
  const label = element() ? "Leave full screen" : "Full screen";
  btn.setAttribute("aria-label", label);
  btn.title = `${label} (F)`;
  const icon = btn.querySelector("[data-icon]");
  const name = element() ? "shrink" : "expand";
  if (icon.dataset.icon !== name) {
    icon.dataset.icon = name;
    hydrateIcons(btn);
  }
}

export function initFullscreen() {
  let open = true;
  try {
    open = localStorage.getItem(TRAY_KEY) !== "0";
  } catch {
    // Open, the default.
  }
  setTray(open, { save: false });

  $("trayTab").addEventListener("click", () => setTray($("tray").classList.contains("collapsed")));
  $("fullscreenBtn").addEventListener("click", toggle);
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  appFullscreen.addEventListener?.("change", sync);

  // F, unless a modal is open or somebody is typing.
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.key.toLowerCase() !== "f" && e.code !== "KeyF") return;
    if (document.body.classList.contains("modal-open") || !supported()) return;
    const t = e.target;
    if (t instanceof Element && (t.closest('input:not([type="range"]), textarea, select') || t.isContentEditable)) return;
    e.preventDefault();
    toggle();
  });
}

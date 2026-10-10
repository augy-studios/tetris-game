// Full screen, from the tray's button or F. The layout stays as it is: the
// brand line and the tray (js/tray.js) are there in full screen too, and the
// board grows into the height the browser's bars gave up.
//
// The manifest no longer launches the installed app full screen, because a
// launch-time full screen cannot be left from the page. An install made before
// that change may still run that way until the browser picks up the new
// manifest; it gets no button there: there is no full screen to leave.

import { hydrateIcons } from "./ui.js";

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

// The button for whether it is full screen now.
function sync() {
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
  sync();

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

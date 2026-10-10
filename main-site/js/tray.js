// The edge tray (edge-tray-spec.md): the app's buttons as a glass column top
// right, with an arrow tab beside it that slides the column off the right edge
// and brings it back. The tray is open until somebody closes it; that choice
// is a per-browser convenience, so storage failing only means it opens again
// next time.

// Keep in step with the head script in index.html.
const TRAY_KEY = "uwutetris.trayOpen";

const $ = (id) => document.getElementById(id);

function setTray(open, { save = true } = {}) {
  $("tray").classList.toggle("collapsed", !open);
  $("trayTab").setAttribute("aria-expanded", String(open));
  $("trayTab").setAttribute("aria-label", open ? "Hide menu" : "Show menu");
  // Off screen buttons must not take focus or clicks.
  $("trayButtons").inert = !open;
  document.body.classList.toggle("tray-open", open);
  if (!save) return;
  try {
    localStorage.setItem(TRAY_KEY, open ? "1" : "0");
  } catch {
    // Remembered for this page view only.
  }
}

export function initTray() {
  let open = true;
  try {
    open = localStorage.getItem(TRAY_KEY) !== "0";
  } catch {
    // Open, the default.
  }
  setTray(open, { save: false });
  // The head script painted the stored state with transitions off. Hand over
  // a frame later, so only toggles from here on animate.
  requestAnimationFrame(() => document.documentElement.classList.remove("tray-start-collapsed"));

  $("trayTab").addEventListener("click", () => setTray($("tray").classList.contains("collapsed")));
}

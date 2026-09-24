// Page wiring: the theme modal (uwuapps-theme.md, section 6) and the update
// bar. The game itself lives in /script.js and only reads the theme tokens.

import { COLOR_THEMES, applyColorTheme, applyMode, getStoredColorTheme, getStoredMode, getModePreference, initTheme } from "./theme.js";
import { hydrateIcons, openModal, closeModal } from "./ui.js";
import { initUpdateBar } from "./update.js";

function buildThemeModal() {
  const grid = document.getElementById("swatchGrid");
  grid.innerHTML = COLOR_THEMES.map(
    (t) => `
      <button class="swatch" data-theme-id="${t.id}" style="--swatch-color:${t.hex}" type="button" aria-label="${t.label}">
        <span class="swatch-dot"></span>
        <span class="swatch-label">${t.label}</span>
      </button>`
  ).join("");

  syncThemeModalState();

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-id]");
    if (!btn) return;
    applyColorTheme(btn.dataset.themeId);
    syncThemeModalState();
  });

  document.getElementById("modeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-mode]");
    if (!btn) return;
    applyMode(btn.dataset.mode);
    syncThemeModalState();
  });

  // A tab left open across 09:00 or 18:00 re-resolves itself; redraw the
  // modal so the note and pressed state stay in step with the change.
  document.addEventListener("uwu:modechange", syncThemeModalState);
}

function syncThemeModalState() {
  const activeTheme = getStoredColorTheme();
  const activePreference = getModePreference();
  const resolvedMode = getStoredMode();

  document.querySelectorAll("#swatchGrid .swatch").forEach((el) => {
    el.classList.toggle("active", el.dataset.themeId === activeTheme);
  });
  document.querySelectorAll("#modeToggle .mode-btn").forEach((el) => {
    const isActive = el.dataset.mode === activePreference;
    el.classList.toggle("active", isActive);
    el.setAttribute("aria-pressed", String(isActive));
  });

  const note = document.getElementById("modeNote");
  if (note) {
    note.hidden = activePreference !== "time";
    if (activePreference === "time") {
      note.textContent = `Following the clock. Currently ${resolvedMode}.`;
    }
  }

  updateThemeButtonIcon();
}

function updateThemeButtonIcon() {
  const span = document.querySelector("#themeBtn [data-icon]");
  span.setAttribute("data-icon", getStoredMode() === "dark" ? "moon" : "sun");
  hydrateIcons(document.getElementById("themeBtn"));
}

// Focus goes into the dialog on open and back to its trigger on close, and
// Escape closes it. The game pauses its input while body.modal-open is set.
function wireModals() {
  const themeBtn = document.getElementById("themeBtn");

  const close = (id) => {
    closeModal(id);
    if (id === "themeModal") themeBtn.focus();
  };

  document.querySelectorAll("[data-close-modal]").forEach((btn) => {
    btn.addEventListener("click", () => close(btn.dataset.closeModal));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(backdrop.id);
    });
  });
  themeBtn.addEventListener("click", () => {
    openModal("themeModal");
    document.querySelector("#themeModal [data-close-modal]").focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = document.querySelector(".modal-backdrop:not(.hidden)");
    if (!open) return;
    // Handled here, so the game does not read the same Escape as "pause".
    e.preventDefault();
    close(open.id);
  });
}

function boot() {
  try {
    initTheme();
    hydrateIcons();
    updateThemeButtonIcon();
    buildThemeModal();
    wireModals();
  } catch (cause) {
    // Storage blocked outright (some privacy settings throw on localStorage).
    // The page still renders light + classic from the stylesheet defaults.
    console.warn("theme unavailable:", cause);
    hydrateIcons();
  }

  initUpdateBar();
}

boot();

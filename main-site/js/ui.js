import { icon } from "./icons.js";

// Safe to call repeatedly; re-renders when data-icon changes.
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    const name = el.dataset.icon;
    if (el.dataset.iconRendered === name) return;
    el.innerHTML = icon(name);
    el.dataset.iconRendered = name;
  });
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// The clipboard's way, or the older copy command from a field made for it.
// True when it went.
export async function copyText(text) {
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

export function isModalOpen(id) {
  return !document.getElementById(id).classList.contains("hidden");
}

// Focus goes into the modal on open and back to the opener on close.
const openers = new Map();

export function openModal(id) {
  const backdrop = document.getElementById(id);
  openers.set(id, document.activeElement);
  backdrop.classList.remove("hidden");
  document.body.classList.add("modal-open");
  backdrop.querySelector("button, [href], input")?.focus();
}

export function closeModal(id) {
  document.getElementById(id).classList.add("hidden");
  if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
    document.body.classList.remove("modal-open");
  }
  openers.get(id)?.focus?.();
  openers.delete(id);
}

export function closeTopModal() {
  const open = [...document.querySelectorAll(".modal-backdrop:not(.hidden)")].pop();
  if (!open) return false;
  closeModal(open.id);
  return true;
}

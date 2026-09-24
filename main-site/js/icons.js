// Inline SVG icons. viewBox 0 0 24 24, stroke 1.8, round caps and joins,
// colour from currentColor so every icon follows the theme.

const svg = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  sun: svg(`<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>`),
  moon: svg(`<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>`),
  close: svg(`<path d="M18 6 6 18M6 6l12 12"/>`),
  clock: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`),

  // Touch controls
  chevronLeft: svg(`<path d="m15 18-6-6 6-6"/>`),
  chevronRight: svg(`<path d="m9 18 6-6-6-6"/>`),
  chevronDown: svg(`<path d="m6 9 6 6 6-6"/>`),
  hardDrop: svg(`<path d="m7 4 5 5 5-5M7 10l5 5 5-5M5 20h14"/>`),
  rotateCw: svg(`<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.5"/><path d="M20 3.5v5h-5"/>`),
  rotateCcw: svg(`<path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.5"/><path d="M4 3.5v5h5"/>`),
  pause: svg(`<path d="M9 5v14M15 5v14"/>`),
};

export function icon(name) {
  return icons[name] || "";
}

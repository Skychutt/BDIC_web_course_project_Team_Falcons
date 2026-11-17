import { filmArtwork } from './film-artwork.js';

export const esc = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (value) =>
  new Intl.NumberFormat("en-CN", {
    style: "currency",
    currency: "CNY",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0) / 100);
export function dateTime(value, opts = {}) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...opts,
  }).format(d);
}
export const timeOnly = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
export function beijingDate(offset = 0) {
  const date = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export const screenName = (value) =>
  ({ STANDARD: "Standard", IMAX: "IMAX", DOLBY_CINEMA: "Dolby Cinema" })[
    value
  ] ?? value;
export const statusName = (value) =>
  ({
    CONFIRMED: "Confirmed",
    RESCHEDULED: "Rescheduled",
    CINEMA_CANCELLED: "Cinema cancelled",
    PENDING: "Pending",
    FAILED: "Needs retry",
    SUCCEEDED: "Completed",
    AVAILABLE: "Available",
    USED: "Used",
    ACTIVE: "Active",
    EXPIRED: "Expired",
    CONVERTED: "Purchased",
    CANCELLED: "Cancelled",
    PUBLISHED: "On sale",
  })[value] ?? value;
export const empty = (title, description = "") =>
  `<div class="empty"><span class="empty-mark" aria-hidden="true">—</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div>`;
export const notice = (text, kind = "info") =>
  `<div class="notice ${esc(kind)}" role="${kind === "error" ? "alert" : "status"}">${esc(text)}</div>`;
export const icon = (name) => {
  const paths = {
    arrow: "M4 12h16m-6-6 6 6-6 6",
    search: "m20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
    pin: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
    ticket:
      "M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v3a2 2 0 0 0 0 4v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a2 2 0 0 0 0-4V7Zm12-1v3m0 2v2m0 2v3",
    close: "m6 6 12 12M6 18 18 6",
    spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
    clock: "M12 7v5l3 2m7-2a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
    check: "m5 12 4 4L19 6",
    chevron: "m8 5 7 7-7 7",
    user: "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  };
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.arrow}"/></svg>`;
};
export const options = (items, selected, label = "name", placeholder = "All") =>
  `${placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : ""}${items.map((i) => `<option value="${esc(i.id)}" ${String(i.id) === String(selected) ? "selected" : ""}>${esc(i[label])}</option>`).join("")}`;
export function toast(message, kind = "success") {
  const region = document.getElementById("toast-region");
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  region.replaceChildren(item);
  setTimeout(() => item.remove(), 6000);
}
export async function busy(button, fn, label = "Working…") {
  if (button.disabled) return;
  const before = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  button.setAttribute("aria-busy", "true");
  try {
    return await fn();
  } finally {
    if (button.isConnected) {
      button.disabled = false;
      button.innerHTML = before;
      button.removeAttribute("aria-busy");
    }
  }
}
export function showError(container, error) {
  container.innerHTML = notice(
    error.userMessage ||
      error.message ||
      "Something went wrong. Please try again.",
    "error",
  );
}
export function field(label, content, hint = "") {
  return `<label class="field"><span>${esc(label)}</span>${content}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}
export function selectField(
  label,
  name,
  items,
  selected,
  placeholder = "Choose…",
) {
  return field(
    label,
    `<select name="${esc(name)}">${options(items, selected, "name", placeholder)}</select>`,
  );
}
export function modal(content) {
  const d = document.createElement("dialog");
  d.className = "modal-dialog";
  d.innerHTML = content;
  document.body.append(d);
  d.addEventListener("close", () => d.remove(), { once: true });
  d.showModal();
  return d;
}
export async function runForm(form, handler) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("[type=submit]");
    await busy(button, () => handler(new FormData(form)));
  });
}
export function poster(film, small = false) {
  const image = filmArtwork(film);
  if (image) return `<div class="film-poster photographic-poster ${small ? 'poster-small' : ''}"><img src="${image}" alt="${esc(film.title)} poster" loading="lazy" decoding="async"></div>`;
  const artwork = film.title === "Journey Beyond the City" ? "city-poster" : "";
  return `<div class="film-poster ${artwork} ${small ? "poster-small" : ""}" aria-label="${esc(film.title)}"><span class="poster-imprint">A FALCONS SCREENING</span><div class="poster-orbit" aria-hidden="true"></div><div class="poster-type">${esc(film.title)}</div><span class="poster-caption">${esc(film.duration_minutes)} MINUTES · DEMO FILM</span></div>`;
}

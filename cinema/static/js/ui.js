import { filmArtwork } from './film-artwork.js';
import { filmTitle } from './film-locale.js';
import { getLanguage, tx } from "./locale.js";

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
  return new Intl.DateTimeFormat(getLanguage() === "zh" ? "zh-CN" : "en-GB", {
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
  ({
    STANDARD: tx("Standard", "标准厅"),
    IMAX: "IMAX",
    DOLBY_CINEMA: tx("Dolby Cinema", "杜比影院"),
  })[value] ?? value;
export const statusName = (value) =>
  ({
    CONFIRMED: tx("Confirmed", "已出票"),
    RESCHEDULED: tx("Rescheduled", "已改签"),
    CINEMA_CANCELLED: tx("Cinema cancelled", "影院取消"),
    PENDING: tx("Pending", "处理中"),
    FAILED: tx("Needs retry", "待重试"),
    SUCCEEDED: tx("Completed", "已完成"),
    AVAILABLE: tx("Available", "可使用"),
    USED: tx("Used", "已使用"),
    ACTIVE: tx("Active", "待支付"),
    EXPIRED: tx("Expired", "已过期"),
    CONVERTED: tx("Purchased", "已购票"),
    CANCELLED: tx("Cancelled", "已取消"),
    PUBLISHED: tx("On sale", "在售"),
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
export const options = (items, selected, label = "name", placeholder = tx("All", "全部")) =>
  `${placeholder !== null ? `<option value="">${esc(placeholder)}</option>` : ""}${items.map((i) => `<option value="${esc(i.id)}" ${String(i.id) === String(selected) ? "selected" : ""}>${esc(i[label])}</option>`).join("")}`;
export function toast(message, kind = "success") {
  const region = document.getElementById("toast-region");
  const item = document.createElement("div");
  item.className = `toast ${kind}`;
  item.textContent = message;
  region.replaceChildren(item);
  setTimeout(() => item.remove(), 6000);
}
export async function busy(button, fn, label = tx("Working…", "处理中…")) {
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
      button.dispatchEvent(new Event("action-finished"));
    }
  }
}
export class LocalizedError extends Error {
  constructor(en, zh) {
    super(en);
    this.chinese = zh;
  }
  get userMessage() { return tx(this.message, this.chinese); }
}

const displayedErrors = new WeakMap();
export function showError(container, error, inline = false) {
  const message = error.userMessage || error.message || tx("Something went wrong. Please try again.", "操作失败，请重试。");
  displayedErrors.set(container, { error, inline });
  if (inline) {
    container.hidden = false;
    container.textContent = message;
  } else container.innerHTML = notice(message, "error");
}
export function field(label, content, hint = "") {
  return `<label class="field"><span>${esc(label)}</span>${content}${hint ? `<small>${esc(hint)}</small>` : ""}</label>`;
}
export function selectField(
  label,
  name,
  items,
  selected,
  placeholder = tx("Choose…", "请选择…"),
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
  const title = esc(filmTitle(film));
  if (image) return `<div class="film-poster photographic-poster ${small ? 'poster-small' : ''}"><img src="${image}" alt="${title} ${tx("poster", "海报")}" loading="lazy" decoding="async"></div>`;
  const artwork = film.title === "Journey Beyond the City" ? "city-poster" : "";
  return `<div class="film-poster ${artwork} ${small ? "poster-small" : ""}" aria-label="${title}"><span class="poster-imprint">${tx("A FALCONS SCREENING", "FALCONS 放映")}</span><div class="poster-orbit" aria-hidden="true"></div><div class="poster-type">${title}</div><span class="poster-caption">${esc(film.duration_minutes)} ${tx("MINUTES · DEMO FILM", "分钟 · 演示影片")}</span></div>`;
}

// Redraw the same view from its loaded data, keeping unsent inputs and expanded details.
// Bind after restoring the values so dependent controls (filters, star captions) see the draft.
export function redrawLocalized(root, render, bind) {
  const controls = "input[name], select[name], textarea[name]";
  const previous = [...root.querySelectorAll(controls)];
  const expanded = [...root.querySelectorAll("details")].map(el => el.open);
  const errorFields = ".form-error, [data-error]";
  const errors = [...root.querySelectorAll(errorFields)].map(el =>
    el.textContent && !el.hidden ? displayedErrors.get(el) : null);
  render();
  root.querySelectorAll(errorFields).forEach((el, i) => {
    if (errors[i]) showError(el, errors[i].error, errors[i].inline);
  });
  root.querySelectorAll(controls).forEach((el, i) => {
    const old = previous[i];
    if (!old || old.name !== el.name || old.type !== el.type) return;
    if (el.type === "checkbox" || el.type === "radio") el.checked = old.checked;
    else el.value = old.value;
  });
  root.querySelectorAll("details").forEach((el, i) => {
    if (i < expanded.length) el.open = expanded[i];
  });
  bind();
}

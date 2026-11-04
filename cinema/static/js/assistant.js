import { esc, money, icon, notice, empty } from "./ui.js";
import { assistantDate, genreLabel, statusLabel, localizeResult, selectedFilmTitle, replyLanguage } from "./assistant-locale.js";

const copy = {
  en: {
    languageHint: "Replies follow your question's language. Earlier messages keep their original language.",
    map: "Cinema map & location",
    hard: "Required", soft: "Preferred", default: "Default", user_explicit: "Your request", model_inferred: "Interpreted", system_default: "System default", ratingPriority: "Higher platform ratings first", recovery: "How would you like to continue?", temporary: "Applies to this task; no long-term preferences saved.",
    title: "Your movie companion", stub: "Offline parser · Live cinema data", live: "DeepSeek · Live cinema data",
    reset: "New conversation", welcome: "Ask for a film, explore platform ratings, plan a visit or check your own tickets after sign-in. You can just chat, too.",
    label: "Your question or movie plans", placeholder: "Tomorrow in Chaoyang, three people, preferably middle seats",
    send: "Send", working: "Checking your plans…", note: "Suggestions do not reserve seats. Choose seats to review live availability.",
    conditions: "Current search conditions", party: "Party size not set", all: "All Beijing", people: "people",
    front: "Front", middle: "Middle", back: "Rear", standard: "Standard", imax: "IMAX", dolby: "Dolby Cinema",
    example: "Tomorrow for three people, middle seats", student: "What are the student ticket rules?",
    cleared: "Your conversation and preferences have been cleared.", you: "You", assistant: "Assistant",
    matches: "Your screening options", together: "Seats together", split: "Split seating", zone: "Zone preference not fully met",
    seats: "Suggested seats", choose: "Choose seats", regular: "Regular", studentFare: "Student", reference: "Reference price per ticket, before coupons",
    noRating: "No ratings yet", minutes: "min", refreshed: "Your session changed. Please send your message again.",
    failure: "The assistant is unavailable. Try again or browse Movies & showtimes.", missing_key: "DeepSeek is selected, but no API key is configured.",
    authentication: "DeepSeek rejected the configured API key.", quota: "DeepSeek account credit is insufficient.",
    rate_limit: "DeepSeek is busy. Please try again later.", timeout: "The model timed out. Your confirmed preferences are kept.",
    invalid_output: "The model response did not pass validation. Your previous preferences are kept.",
    filmExample: "Recommend a film", ratedExample: "Recent highly rated films", ordersExample: "My orders", manualDistrict: "Choose a district (optional)",
    films: "Films to explore", filmDetails: "Film details", filmShowtimes: "Find its showtimes", cinemas: "Cinemas",
    orders: "Your orders", coupons: "Your coupons", previews: "Price preview", account: "View order", signIn: "Sign in",
    platformRating: "Platform rating", ratings: "ratings", per_ticket: "per ticket", total: "whole group", budget: "Budget", scopeNeeded: "confirm budget scope",
    login_required: "Sign in as a customer to use personal queries.", noTools: "Conversation", toolsUsed: "Data checked",
    couponAvailable: "Available", couponUnavailable: "Unavailable for this selection", couponUnchecked: "Choose a screening to check applicability",
    gross: "Ticket subtotal", net: "After discount", fee: "Change fee", due: "Estimated payable (negative = refund)",
    previewNote: "Preview only · no reservation or payment", change: "Review reschedule", eligible: "Eligible to request a change", ineligible: "Change currently unavailable",
    close: "Minimize assistant", preferences: "Current search conditions", hello: "What are we watching?", intro: "A great film. The right seats. Let's find your next movie night.", browse: "Browse movies", retry: "Reconnect", compactPlaceholder: "Ask me anything about your movie night…",
  },
  zh: {
    languageHint: "回复自动跟随提问语言，历史消息保留原文。",
    map: "影院地图与定位",
    hard: "硬限制", soft: "偏好", default: "默认", user_explicit: "你的表达", model_inferred: "助手理解", system_default: "系统默认", ratingPriority: "优先本站高分", recovery: "接下来怎么选？", temporary: "仅用于本次任务，未保存为长期偏好。",
    title: "你的观影助手", stub: "离线解析 · 平台场次数据", live: "DeepSeek · 平台场次数据",
    reset: "新对话", welcome: "可以先聊想看什么、查本站评分，再安排场次；登录后还能查询自己的订单和优惠券。也可以随便聊聊。",
    label: "你的问题或观影计划", placeholder: "明天朝阳区三个人看电影，尽量坐中间",
    send: "发送", working: "正在核对你的观影计划…", note: "推荐不会占座。点击选座，重新确认实时座位和票价。",
    conditions: "本次筛选条件", party: "人数待确认", all: "北京全市", people: "人",
    front: "前区", middle: "中区", back: "后区", standard: "普通厅", imax: "IMAX", dolby: "杜比影院",
    example: "明天三个人看电影，尽量坐中间", student: "学生票有什么要求？",
    cleared: "已清空本次对话和筛选条件。", you: "你", assistant: "观影助手",
    matches: "推荐场次", together: "整组连座", split: "需要分开坐", zone: "未完全满足分区偏好",
    seats: "建议座位", choose: "进入选座", regular: "普通票", studentFare: "学生票", reference: "参考单价，未计算优惠券",
    noRating: "暂无评分", minutes: "分钟", refreshed: "登录状态已变化，请重新发送消息。",
    failure: "AI 暂不可用，可重试或前往电影页面使用普通筛选。", missing_key: "已选择 DeepSeek，但尚未配置 API 密钥。",
    authentication: "DeepSeek 密钥验证失败。", quota: "DeepSeek 账户额度不足。",
    rate_limit: "DeepSeek 请求繁忙，请稍后重试。", timeout: "模型响应超时，已保留确认的条件。",
    invalid_output: "模型响应未通过校验，已保留原条件。",
    filmExample: "推荐一部电影", ratedExample: "最近评分高的电影", ordersExample: "我的订单", manualDistrict: "手动选择区域（可选）",
    films: "影片推荐", filmDetails: "影片详情", filmShowtimes: "查询这部的场次", cinemas: "影院",
    orders: "本人订单", coupons: "本人优惠券", previews: "费用预览", account: "查看订单", signIn: "登录",
    platformRating: "本站评分", ratings: "人评分", per_ticket: "每人", total: "整单", budget: "预算", scopeNeeded: "待确认预算范围",
    login_required: "请先登录顾客账号，再查询本人信息。", noTools: "对话", toolsUsed: "已查询平台数据",
    couponAvailable: "可用", couponUnavailable: "当前选择不可用", couponUnchecked: "选择场次后检查适用性",
    gross: "票面合计", net: "折后票款", fee: "改签手续费", due: "预计需付（负数为退款）",
    previewNote: "仅预览 · 未占座、未付款", change: "进入改签确认", eligible: "当前可以申请改签", ineligible: "当前不能改签",
    close: "收起助手", preferences: "本次筛选条件", hello: "今天，想看点什么？", intro: "从挑一部好电影，到找到合适的座位，陪你安排下一场电影。", browse: "浏览电影", retry: "重新连接", compactPlaceholder: "聊聊你想看的电影，或问我一个问题…",
  },
};

// IDs remain strings end to end, including values beyond Number.MAX_SAFE_INTEGER.
export function recommendationLink(card) {
  if (typeof card.screening_id !== "string" || !/^\d+$/.test(card.screening_id) || !card.suggested_seats?.length || card.suggested_seats.length > 12
      || card.suggested_seats.some((s) => typeof s.id !== "string" || !/^\d+$/.test(s.id))) return null;
  const params = new URLSearchParams({ party_size: String(card.suggested_seats.length),
    seat_ids: card.suggested_seats.map((s) => s.id).join(","), from: "assistant" });
  return `#/seats/${card.screening_id}?${params}`;
}

export function businessLink(kind, id) {
  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) return null;
  if (kind === "film") return `#/film/${id}`;
  if (kind === "cinema") return `#/discover?cinema_id=${id}`;
  if (kind === "order") return `#/account?tab=orders&booking=${id}`;
  if (kind === "reschedule") return `#/discover?source_booking_id=${id}`;
  return null;
}

export async function mountConversation(ctx, panel, results) {
  const { api } = ctx;
  const floating = Boolean(ctx.floating);
  let language = "en";
  try { language = localStorage.getItem("falcons-language") === "zh" ? "zh" : "en"; } catch {}
  let session, filters, conditionState = {}, taskKind, working = false, alive = true, currentCards = [], currentResult = null;
  const controller = ctx.controller || new AbortController();
  controller.signal.addEventListener("abort", () => { alive = false; }, { once: true });
  const t = (key) => copy[language][key] || copy[language].failure;
  const request = (path, options = {}) => api.request(`${path}${path.includes("?") ? "&" : "?"}locale=${language}`, { ...options, signal: controller.signal });
  panel.innerHTML = `<div class="panel-header"><h2 data-ai="title"></h2></div>
    <div class="ai-chat-body"><div class="toolbar"><span class="assistant-mode" id="ai-mode"></span><button type="button" class="button ghost small" id="ai-reset" data-ai="reset"></button></div>
    <label class="field"><span data-ai="manualDistrict"></span><select id="ai-district"></select></label>
    <div class="ai-conditions" id="ai-conditions"></div>
    <div class="ai-transcript" id="ai-transcript" role="log" aria-live="polite" aria-relevant="additions"></div>
    <div class="ai-examples"><button type="button" class="button secondary small" id="ai-film" data-ai="filmExample"></button><button type="button" class="button ghost small" id="ai-rated" data-ai="ratedExample"></button><button type="button" class="button ghost small" id="ai-example" data-ai="example"></button><button type="button" class="button ghost small" id="ai-student" data-ai="student"></button><button type="button" class="button ghost small" id="ai-orders" data-ai="ordersExample"></button></div>
    <form id="chat-form" class="stack"><label class="field"><span data-ai="label"></span><textarea name="message" id="ai-message" maxlength="2000" rows="3" required></textarea></label>
    <div class="ai-composer-row"><span id="ai-count" class="fine-print">0 / 2000</span><button class="button" type="submit" id="ai-send" data-ai="send"></button></div>
    <div class="form-error" role="status" id="ai-status"></div></form><p class="fine-print" data-ai="note"></p></div>`;
  if (floating) {
    panel.innerHTML = `<header class="ai-widget-header"><span class="ai-widget-avatar" aria-hidden="true">${icon("spark")}</span><div class="ai-widget-identity"><span class="ai-widget-brand">FALCONS AI</span><h2 id="ai-widget-title" data-ai="title"></h2></div><div class="ai-widget-actions"><button type="button" id="ai-close" class="ai-widget-icon-button" data-ai-label="close">${icon("close")}</button></div></header>
      <div class="ai-widget-toolbar"><span class="assistant-mode" id="ai-mode"></span><button type="button" class="button ghost small" id="ai-reset" data-ai="reset"></button></div>
      <details class="ai-widget-preferences"><summary><span data-ai="preferences"></span>${icon("chevron")}</summary><label class="field"><span data-ai="manualDistrict"></span><select id="ai-district"></select></label><div class="ai-conditions" id="ai-conditions"></div><p class="fine-print" data-ai="languageHint"></p></details>
      <div class="ai-widget-feed" id="ai-feed"><div class="ai-widget-welcome" id="ai-welcome"><span class="ai-widget-welcome-mark" aria-hidden="true">${icon("spark")}</span><h3 data-ai="hello"></h3><p data-ai="intro"></p></div>
        <div class="ai-examples"><button type="button" class="button secondary small" id="ai-film" data-ai="filmExample"></button><button type="button" class="button ghost small" id="ai-rated" data-ai="ratedExample"></button><button type="button" class="button ghost small" id="ai-example" data-ai="example"></button><button type="button" class="button ghost small" id="ai-student" data-ai="student"></button><button type="button" class="button ghost small" id="ai-orders" data-ai="ordersExample"></button></div>
        <div class="ai-transcript" id="ai-transcript" role="log" aria-live="polite" aria-relevant="additions"></div></div>
      <div class="ai-widget-composer"><div class="form-error" role="status" id="ai-status"></div><form id="chat-form"><label class="ai-widget-input-label" for="ai-message" data-ai="label"></label><textarea name="message" id="ai-message" maxlength="2000" rows="2" required></textarea><div class="ai-composer-row"><span id="ai-count" class="fine-print">0 / 2000</span><button class="button" type="submit" id="ai-send"><span data-ai="send"></span>${icon("arrow")}</button></div></form><p class="fine-print ai-widget-note" data-ai="note"></p></div>`;
    panel.querySelector("#ai-feed").append(results);
    panel.querySelector("#ai-close").onclick = ctx.onClose;
  }
  const el = (id) => panel.querySelector(`#${id}`);
  const focusInput = () => { if (!floating || ctx.isOpen?.()) el("ai-message")?.focus({ preventScroll: true }); };
  function scrollToLatest() {
    const feed = floating ? el("ai-feed") : el("ai-transcript");
    // Keep the start of large recommendation cards in view instead of skipping to the last card.
    if (floating) feed.scrollTop = el("ai-transcript").lastElementChild?.offsetTop - feed.offsetTop || 0;
    else feed.scrollTop = feed.scrollHeight;
  }
  function conditions() {
    if (!filters) return;
    const district = session.districts.find((d) => d.id === filters.district);
    const items = [];
    const add = (field, label) => {
      const meta = conditionState[field];
      const suffix = meta?.status === "active" ? ` · ${t(meta.strength)}` : "";
      const title = meta ? `${t(meta.source)}${meta.original_text ? ` · ${meta.original_text}` : ""}` : "";
      items.push(`<span class="badge" title="${esc(title)}">${esc(label + suffix)}</span>`);
    };
    add(filters.district ? "district" : "city", filters.city !== "beijing" ? filters.city : district?.[language] || t("all"));
    if (taskKind === "screenings" || !taskKind && filters.party_size) {
      add("date", filters.date);
      if (filters.party_size) add("party_size", `${filters.party_size} ${t("people")}`);
      if (filters.time_start || filters.time_end) add("time_start", `${filters.time_start || "00:00"}–${filters.time_end || "24:00"}`);
      if (filters.hall_type) add("hall_type", t(filters.hall_type));
      if (filters.zone) add("zone", t(filters.zone));
      if (filters.budget_minor != null) add("budget_minor", `${t("budget")} ${money(filters.budget_minor)} · ${filters.budget_scope ? t(filters.budget_scope) : t("scopeNeeded")}`);
    }
    if (filters.film_query) add("film_query", selectedFilmTitle(filters, session.films, language));
    if (filters.genre) add("genre", genreLabel(filters.genre, language));
    if (filters.keyword) add("keyword", filters.keyword);
    if (filters.min_rating != null) add("min_rating", `${t("platformRating")} ≥ ${filters.min_rating}/10`);
    else if (filters.sort_by_rating) add("sort_by_rating", t("ratingPriority"));
    el("ai-conditions").setAttribute("aria-label", t("conditions"));
    el("ai-conditions").innerHTML = items.join("") + `<p class="fine-print">${t("temporary")}</p>`;
    if (session?.districts) {
      el("ai-district").innerHTML = `<option value="">${t("all")}</option>` + session.districts.map((d) => `<option value="${esc(d.id)}">${esc(d[language])}</option>`).join("");
      el("ai-district").value = filters.district || "";
    }
  }
  function cards(values) {
    currentCards = values;
    if (!values.length) return;
    results.dataset.source = "ai";
    results.innerHTML = `<div class="results-heading"><h2>${t("matches")}</h2></div>` + values.map((card) => {
      const link = recommendationLink(card);
      return `<article class="recommendation"><div class="toolbar"><span class="badge">${t(card.hall_type)}</span><span class="fine-print">${assistantDate(card.starts_at, language)}</span></div>
        <h3>${esc(card.film.title)}</h3><p class="muted">${esc(card.cinema.name)}</p><p class="fine-print">${card.film.duration_minutes} ${t("minutes")} · ${card.film.rating_count ? `${esc(card.film.rating)}/10 (${card.film.rating_count})` : t("noRating")}</p>
        <p>${t(card.contiguous ? "together" : "split")} · ${t("seats")}: ${card.suggested_seats.map((s) => esc(s.label)).join(" / ")}</p>
        ${card.unmet_preferences.includes("preferred_zone") ? notice(t("zone"), "warning") : ""}
        <p>${t("regular")} ${money(card.fares.regular)} · ${t("studentFare")} ${money(card.fares.student)}</p><p class="fine-print">${t("reference")}</p>
        ${link ? `<a class="button" href="${esc(link)}">${t("choose")} ${icon("arrow")}</a>` : ""}</article>`;
    }).join("") + `<p class="fine-print">${t("note")}</p>`;
  }
  function businessResults(data) {
    currentResult = data;
    data = localizeResult(data, language);
    const parts = [];
    if (data.recovery?.options?.length) parts.push(`<section class="ai-recovery" aria-label="${t("recovery")}"><h3>${t("recovery")}</h3><div class="stack">${data.recovery.options.map((option) => `<button type="button" class="button secondary small" data-ai-recovery="${esc(option.id)}">${esc(option.label[language])}</button>`).join("")}</div></section>`);
    if (data.location?.action === "open_cinema_map") parts.push(`<a class="button" href="#/cinemas">${t("map")} ${icon("pin")}</a>`);
    const link = (kind, id, label) => { const href = businessLink(kind, id); return href ? `<a class="button ghost small" href="${esc(href)}">${esc(label)}</a>` : ""; };
    if (data.cards?.length) { cards(data.cards); parts.push(results.innerHTML); }
    else currentCards = [];
    if (data.films?.length) parts.push(`<h2>${t("films")}</h2>` + data.films.map((f, i) => `<article class="recommendation"><span class="badge">${i + 1}</span><h3>${esc(f.title)}</h3><p class="fine-print">${esc(f.duration_minutes)} ${t("minutes")} · ${esc((f.genres || []).join(" / "))}</p><p>${t("platformRating")}: ${f.rating_count ? `${esc(f.rating)}/10 · ${esc(f.rating_count)} ${t("ratings")}` : t("noRating")}</p><p>${esc(f.synopsis)}</p><div class="actions">${link("film", f.id, t("filmDetails"))}<button type="button" class="button secondary small" data-ai-film="${i + 1}">${t("filmShowtimes")}</button></div></article>`).join(""));
    if (data.cinemas?.length) parts.push(`<h2>${t("cinemas")}</h2>` + data.cinemas.map((c, i) => `<article class="recommendation"><span class="badge">${i + 1}</span><h3>${esc(c.name)}</h3><p>${esc(c.address)}</p>${link("cinema", c.id, t("filmShowtimes"))}</article>`).join(""));
    if (data.orders?.length) parts.push(`<h2>${t("orders")}</h2>` + data.orders.map((o, i) => `<article class="recommendation"><span class="badge">${i + 1} · ${esc(statusLabel(o.status, language))}</span><h3>${esc(o.film_title)}</h3><p>${esc(o.cinema_name)} · ${assistantDate(o.starts_at, language)}</p><p>${esc(o.seats.join(" / "))}</p>${link("order", o.id, t("account"))}</article>`).join(""));
    if (data.coupons?.length) parts.push(`<h2>${t("coupons")}</h2>` + data.coupons.map((c, i) => `<article class="recommendation"><span class="badge">${i + 1} · ${esc(statusLabel(c.status, language))}</span><h3>${esc(c.cinema_name)}</h3><p>${esc(c.price_factor_bps / 100)}% ${language === "zh" ? "票价系数" : "of ticket price"}</p><p>${t(c.scope_checked ? c.applicable ? "couponAvailable" : "couponUnavailable" : "couponUnchecked")}</p></article>`).join(""));
    if (data.reschedule) { const r = data.reschedule; parts.push(`<article class="recommendation"><h3>${t(r.eligible ? "eligible" : "ineligible")}</h3>${r.eligible ? `<p>${t("fee")}: ${money(r.fee_minor)}</p>${link("reschedule", r.order_id, t("change"))}` : ""}</article>`); }
    if (data.previews?.length) parts.push(...data.previews.map((p) => `<article class="recommendation"><h3>${t("previews")}</h3><p>${t("regular")}: ${esc(p.regular_count)} · ${t("studentFare")}: ${esc(p.student_count)}</p><p>${t("gross")}: ${money(p.gross_ticket_minor)}</p><p>${t("net")}: ${money(p.net_ticket_minor)}</p><p>${t("fee")}: ${money(p.current_fee_minor)}</p><strong>${t("due")}: ${money(p.amount_due_minor)}</strong><p class="fine-print">${t("previewNote")}</p></article>`));
    if (data.status === "login_required") parts.push(`<a class="button" href="#/login?next=%23%2Fassistant">${t("signIn")}</a>`);
    results.dataset.source = "ai";
    results.innerHTML = parts.join("") || (floating ? "" : empty(data.reply));
    results.hidden = !parts.length && floating;
    results.querySelectorAll("[data-ai-recovery]").forEach((button) => button.addEventListener("click", () => recover(data.recovery, button.dataset.aiRecovery)));
    results.querySelectorAll("[data-ai-film]").forEach((button) => button.addEventListener("click", () => send(language === "zh" ? `查第${button.dataset.aiFilm}部电影的场次` : `Show screenings for film number ${button.dataset.aiFilm}`)));
  }
  function labels() {
    panel.setAttribute("lang", language === "zh" ? "zh-CN" : "en");
    panel.querySelectorAll("[data-ai]").forEach((n) => { n.textContent = t(n.dataset.ai); });
    panel.querySelectorAll("[data-ai-label]").forEach((n) => { n.setAttribute("aria-label", t(n.dataset.aiLabel)); n.title = t(n.dataset.aiLabel); });
    panel.querySelectorAll("[data-ai-role]").forEach(heading => { heading.textContent = t(heading.dataset.aiRole); });
    panel.querySelectorAll("[data-film-zh]").forEach(button => { button.textContent = button.dataset[language === "zh" ? "filmZh" : "filmEn"]; });
    el("ai-message").placeholder = t(floating ? "compactPlaceholder" : "placeholder");
    el("ai-mode").textContent = t(session?.provider === "deepseek" ? "live" : "stub");
    conditions();
    if (currentResult && results.dataset.source === "ai") businessResults(currentResult);
    ctx.onLanguage?.(language);
  }
  function message(role, text) {
    const item = document.createElement("article");
    item.className = `ai-message ${role}`;
    const heading = document.createElement("strong"); heading.textContent = t(role); heading.dataset.aiRole = role;
    const body = document.createElement("p"); body.textContent = text; body.lang = language === "zh" ? "zh-CN" : "en";
    item.append(heading, body); el("ai-transcript").append(item);
    while (el("ai-transcript").children.length > 16) el("ai-transcript").firstElementChild.remove();
    scrollToLatest();
    return item;
  }
  function setWorking(value) {
    working = value;
    ctx.assistantBusy = value;
    panel.querySelectorAll("button:not(#ai-close)").forEach((b) => { b.disabled = value; });
    results.querySelectorAll("[data-ai-film]").forEach((b) => { b.disabled = value; });
    el("ai-district").disabled = value;
    const filterSubmit = ctx.root.querySelector('#assistant-form [type="submit"]');
    if (filterSubmit) filterSubmit.disabled = value;
    el("ai-status").textContent = value ? t("working") : "";
    el("ai-transcript").setAttribute("aria-busy", String(value));
  }
  async function bootstrap() {
    const value = await request("/ai/session");
    if (!alive) return;
    session = value;
    api.csrf = session.csrf_token;
    setState(session);
  }
  async function failure(error) {
    if (!alive || error.name === "AbortError") return;
    if (error.status === 403 && ["CSRF", "csrf"].includes(error.code)) {
      try { await bootstrap(); if (alive) labels(); } catch {}
      if (alive) message("assistant", t("refreshed"));
    } else message("assistant", t("failure"));
  }
  function setState(data) {
    if (data.locale && data.locale !== language) {
      language = data.locale;
      try { localStorage.setItem("falcons-language", language); } catch {}
      labels();
    }
    filters = data.filters;
    conditionState = data.conditions || {};
    taskKind = data.task?.kind;
  }
  async function recover(recovery, optionId) {
    if (working || !session) return;
    const option = recovery.options.find((item) => item.id === optionId);
    if (!option) return;
    setWorking(true); message("you", option.label[language]);
    try {
      const data = await request("/ai/recovery", { method: "POST", body: { token: recovery.token, option_id: optionId, locale: language } });
      if (!alive) return;
      setState(data); conditions(); message("assistant", data.reply); businessResults(data);
      scrollToLatest(); ctx.onReply?.();
    } catch (error) { await failure(error); }
    finally { if (alive) { setWorking(false); focusInput(); } }
  }
  async function send(text) {
    text = text.trim();
    if (working || ctx.assistantBusy || !text || text.length > 2000 || !session) return;
    language = replyLanguage(text, language);
    try { localStorage.setItem("falcons-language", language); } catch {}
    labels();
    if (floating) { el("ai-welcome").hidden = true; results.hidden = true; }
    setWorking(true); message("you", text); el("ai-message").value = ""; el("ai-count").textContent = "0 / 2000";
    try {
      const data = await request("/assistant/chat", { method: "POST", body: { message: text, locale: language } });
      if (!alive) return;
      setState(data); conditions();
      const answer = message("assistant", data.reply || t(data.error_code || "failure"));
      businessResults(data);
      if (data.status === "needs_clarification") data.films.forEach((film) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "button secondary small";
        button.textContent = film.titles?.[language] || film.title;
        button.dataset.filmZh = film.titles?.zh || film.title; button.dataset.filmEn = film.titles?.en || film.title;
        button.addEventListener("click", () => send(language === "zh" ? `《${film.titles?.zh || film.title}》` : `Tell me about "${film.titles?.en || film.title}"`)); answer.append(button);
      });
      scrollToLatest();
      ctx.onReply?.();
    } catch (error) { await failure(error); }
    finally { if (alive) { setWorking(false); focusInput(); } }
  }
  labels(); setWorking(true);
  try { await bootstrap(); if (alive) { labels(); if (!floating) message("assistant", t("welcome")); } }
  catch (error) {
    if (alive && error.name !== "AbortError") {
      if (floating) {
        el("ai-feed").innerHTML = `${notice(t("failure"), "error")}<button type="button" class="button" id="ai-retry">${t("retry")}</button><a class="button ghost" href="#/discover">${t("browse")}</a>`;
        el("ai-retry").onclick = ctx.onRetry;
        el("chat-form").hidden = true;
      } else panel.innerHTML = notice(t("failure"), "error");
    }
    return () => controller.abort();
  }
  finally { if (alive && el("ai-transcript")) setWorking(false); }
  if (!alive) return () => controller.abort();
  el("chat-form").onsubmit = (event) => { event.preventDefault(); send(el("ai-message").value); };
  el("ai-message").oninput = () => { el("ai-count").textContent = `${el("ai-message").value.length} / 2000`; };
  el("ai-message").onkeydown = (event) => { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); el("chat-form").requestSubmit(); } };
  el("ai-example").onclick = () => send(t("example"));
  el("ai-film").onclick = () => send(t("filmExample"));
  el("ai-rated").onclick = () => send(t("ratedExample"));
  el("ai-orders").onclick = () => send(t("ordersExample"));
  el("ai-district").onchange = async () => {
    if (working) return;
    const district = el("ai-district").value || null;
    setWorking(true);
    try {
      const data = await request("/ai/preferences", { method: "PATCH", body: { city: "beijing", district } });
      if (alive) { setState(data); conditions(); }
    } catch (error) { await failure(error); }
    finally { if (alive) setWorking(false); }
  };
  el("ai-student").onclick = () => send(t("student"));
  el("ai-reset").onclick = async () => {
    if (working) return; setWorking(true);
    try {
      const data = await request("/ai/session", { method: "DELETE" });
      if (!alive) return;
      setState(data); currentCards = []; currentResult = null; conditions(); el("ai-transcript").replaceChildren();
      el("ai-message").value = ""; el("ai-count").textContent = "0 / 2000";
      if (floating) { el("ai-welcome").hidden = false; results.replaceChildren(); results.hidden = true; el("ai-feed").scrollTop = 0; }
      else { message("assistant", t("cleared")); results.innerHTML = empty(t("welcome")); }
    } catch (error) { await failure(error); }
    finally { if (alive) setWorking(false); }
  };
  return () => { alive = false; controller.abort(); };
}

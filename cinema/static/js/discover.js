import { renderCatalogue } from "./catalogue.js";
import { bindFeaturedCarousel } from "./featured-carousel.js";
import { filmRating } from "./film-rating.js";
import { filmTitle, filmSynopsis, genreName } from "./film-locale.js";
import { renderCinemaMap } from "./cinema-map.js";
import { tx } from "./locale.js";
import {
  esc,
  money,
  dateTime,
  timeOnly,
  beijingDate,
  screenName,
  empty,
  notice,
  icon,
  options,
  poster,
  busy,
  showError,
} from "./ui.js";
const allowed = [
  "district_id",
  "cinema_id",
  "film_id",
  "genre_id",
  "date",
  "start_from",
  "start_to",
  "party_size",
  "screen_type",
  "zone",
  "page",
  "page_size",
];
const comparisonFilters = ["fare_type", "budget_minor", "budget_scope", "require_contiguous"];
function filtersFrom(params) {
  const f = { date: beijingDate(), party_size: "1" };
  const names = params.get("source_booking_id") ? allowed : [...allowed, ...comparisonFilters];
  for (const name of names) if (params.get(name)) f[name] = params.get(name);
  return f;
}
const shortDate = (value) =>
  new Intl.DateTimeFormat(tx("en-GB", "zh-CN"), {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value + "T12:00:00+08:00"));
function dateLabel(value) {
  return value === beijingDate()
    ? tx("Today", "今天")
    : value === beijingDate(1)
      ? tx("Tomorrow", "明天")
      : shortDate(value);
}
function peopleLabel(count) {
  return `${count} ${tx(Number(count) === 1 ? "person" : "people", "人")}`;
}
function comparisonFields(f) {
  const budget = f.budget_yuan ?? (f.budget_minor === undefined ? "" : Number(f.budget_minor) / 100);
  return `<label class="field"><span>${tx("Ticket type", "票种")}</span><select name="fare_type">
      <option value="regular">${tx("Standard", "标准票")}</option><option value="student" ${f.fare_type === "student" ? "selected" : ""}>${tx("Student", "学生票")}</option>
    </select></label>
    <label class="field"><span>${tx("Maximum budget (¥)", "最高预算（¥）")}</span><input type="number" name="budget_yuan" min="0" max="100000" step="0.01" placeholder="${tx("No limit", "不限")}" value="${esc(budget)}"></label>
    <label class="field"><span>${tx("Budget applies to", "预算按")}</span><select name="budget_scope">
      <option value="total">${tx("Whole group", "整组")}</option><option value="per_ticket" ${f.budget_scope === "per_ticket" ? "selected" : ""}>${tx("Per ticket", "每张票")}</option>
    </select></label>
    <label class="field"><span>${tx("Seat arrangement", "座位安排")}</span><select name="require_contiguous">
      <option value="">${tx("Allow separate seats", "可以分开坐")}</option><option value="true" ${["true", "1"].includes(f.require_contiguous) ? "selected" : ""}>${tx("Must sit together", "必须连座")}</option>
    </select></label>`;
}
function fields(bootstrap, f, source, compact = false) {
  const cinemas = bootstrap.cinemas.filter(
    (c) => c.is_active && (!f.district_id || c.district_id === f.district_id),
  );
  const films = bootstrap.films.map((film) => ({ id: film.id, name: filmTitle(film) }));
  const genres = bootstrap.genres.map((genre) => ({ id: genre.id, name: genreName(genre) }));
  const fixed = source ? "disabled" : "";
  const expanded = f.film_id || f.genre_id || f.zone || f.screen_type || f.start_from || f.start_to
    || f.fare_type === "student" || f.budget_minor !== undefined || f.budget_scope === "per_ticket" || f.require_contiguous;
  const people = Array.from({ length: 12 }, (_, i) => {
    const count = i + 1;
    return `<option value="${count}" ${String(count) === String(f.party_size) ? "selected" : ""}>${peopleLabel(count)}</option>`;
  }).join("");
  const screens = [
    { id: "STANDARD", name: tx("Standard", "标准厅") },
    { id: "IMAX", name: "IMAX" },
    { id: "DOLBY_CINEMA", name: tx("Dolby Cinema", "杜比影院") },
  ];
  const zones = [
    { id: "FRONT", name: tx("Front", "前排") },
    { id: "MIDDLE", name: tx("Middle", "中排") },
    { id: "REAR", name: tx("Rear", "后排") },
  ];
  const advanced = source
    ? tx("Film, screen & seat preferences", "影片、厅型与座位偏好")
    : tx("Ticket prices, seating & other filters", "票价、座位和其他筛选");
  return `${source ? `<input type="hidden" name="cinema_id" value="${esc(source.cinema_id)}"><input type="hidden" name="film_id" value="${esc(source.film_id)}"><input type="hidden" name="party_size" value="${source.tickets.length}">` : ""}<div class="${compact ? "form-grid" : "search-main"}"><label class="field"><span>${tx("District", "行政区")}</span><select name="district_id" ${source ? "disabled" : ""}>${options(bootstrap.districts, f.district_id, "name", tx("All Beijing", "全北京"))}</select></label><label class="field"><span>${tx("Cinema", "影院")}</span><select name="cinema_id" ${fixed}>${options(cinemas, f.cinema_id, "name", tx("All cinemas", "全部影院"))}</select></label><label class="field"><span>${tx("Date", "日期")}</span><input name="date" type="date" value="${esc(f.date)}" max="9999-12-30" required></label><label class="field"><span>${tx("People", "人数")}</span><select name="party_size" ${fixed}>${people}</select></label>${compact ? "" : `<button class="button" type="submit">${icon("search")} ${tx("Find showtimes", "查找场次")}</button>`}</div><${compact ? "div" : "details"} class="${compact ? "form-grid" : "search-advanced"}" ${!compact && expanded ? "open" : ""}>${compact ? "" : `<summary><span>${advanced}</span><span>＋</span></summary><div class="form-grid three">`}<label class="field"><span>${tx("Film", "影片")}</span><select name="film_id" ${fixed}>${options(films, f.film_id, "name", tx("All films", "全部影片"))}</select></label><label class="field"><span>${tx("Genre", "类型")}</span><select name="genre_id" ${source ? "disabled" : ""}>${options(genres, f.genre_id, "name", tx("Any genre", "不限类型"))}</select></label><label class="field"><span>${tx("Screen type", "厅型")}</span><select name="screen_type">${options(screens, f.screen_type, "name", tx("Any screen", "不限厅型"))}</select></label><label class="field"><span>${tx("Start after", "开场不早于")}</span><input name="start_from" type="time" value="${esc(f.start_from || "")}"></label><label class="field"><span>${tx("Start before", "开场早于")}</span><input name="start_to" type="time" value="${esc(f.start_to || "")}"></label><label class="field"><span>${tx("Seat preference", "座位偏好")}</span><select name="zone">${options(zones, f.zone, "name", tx("No preference", "不限"))}</select></label>${source ? "" : comparisonFields(f)}${compact ? "" : "</div>"}</${compact ? "div" : "details"}>${compact ? `<button class="button wide" type="submit">${tx("Find my screening", "查找这场")} ${icon("arrow")}</button>` : ""}`;
}
function bindCinemaFilter(form, bootstrap, source) {
  if (source) return;
  form.elements.district_id.addEventListener("change", () => {
    const selected = form.elements.cinema_id.value;
    const cinemas = bootstrap.cinemas.filter(
      (c) =>
        c.is_active &&
        (!form.elements.district_id.value ||
          c.district_id === form.elements.district_id.value),
    );
    form.elements.cinema_id.innerHTML = options(
      cinemas,
      selected,
      "name",
      tx("All cinemas", "全部影院"),
    );
  });
}
function formFilters(form) {
  const result = {};
  for (const [key, value] of new FormData(form))
    if (value && (allowed.includes(key) || comparisonFilters.includes(key))) result[key] = String(value);
  const budget = form.elements.budget_yuan;
  if (budget && budget.value !== "") result.budget_minor = String(Math.round(budget.valueAsNumber * 100));
  return result;
}
function seatLink(screening, source, fareType) {
  const params = new URLSearchParams({
    party_size: String(screening.suggestion.seat_ids.length),
    seat_ids: screening.suggestion.seat_ids.join(","),
  });
  if (source) params.set("source_booking_id", source.id);
  else if (fareType === "student") params.set("fare_type", "student");
  return `#/seats/${screening.id}?${params}`;
}
function sessionCard(s, cinema, source, fareType) {
  const student = !source && fareType === "student";
  const price = s.fares.find((fare) => fare.fare_type === (student ? "STUDENT" : "STANDARD"))?.price_minor;
  const count = s.suggestion.seat_ids.length;
  const total = price == null
    ? tx("Price unavailable", "暂无价格")
    : tx(`${money(count * price)} total before coupons`, `优惠前合计 ${money(count * price)}`);
  const ticketLabel = tx(
    `${count} ${student ? "student" : "standard"} ticket${count === 1 ? "" : "s"}`,
    `${count} 张${student ? "学生票" : "标准票"}`,
  );
  const comparison = source ? "" : `<span class="session-total">${ticketLabel} · ${total}</span>`;
  return `<a class="session-button" href="${seatLink(s, source, fareType)}" aria-label="${esc(timeOnly(s.starts_at))} ${tx("at", "·")} ${esc(cinema?.name || s.cinema_name)}${source ? "" : `, ${ticketLabel}, ${total}`}, ${tx("choose seats", "选座")}">
    <span class="session-time">${timeOnly(s.starts_at)}</span><span class="session-price">${price == null ? "—" : money(price)}${source ? "" : " " + tx("each", "每张")}</span>
    <span class="session-end">${tx("Ends", "散场")} ${timeOnly(s.ends_at)}</span><span class="session-screen">${esc(screenName(s.screen_type))} · ${esc(s.screen_name)}</span>
    ${comparison}<span class="session-availability">${icon("check")}${s.suggestion.adjacent ? tx("Seats together available", "有连座") : tx("Separate seats suggested", "建议分开坐")} · ${s.available_count} ${tx("left", "座可选")}</span></a>`;
}
function renderGroups(items, bootstrap, source, fareType) {
  const groups = new Map();
  for (const s of items) {
    if (!groups.has(s.film_id)) groups.set(s.film_id, []);
    groups.get(s.film_id).push(s);
  }
  return [...groups]
    .map(([fid, screenings]) => {
      const film = bootstrap.films.find((f) => f.id === fid) || {
        id: fid,
        title: screenings[0].title,
        duration_minutes: screenings[0].duration_minutes_snapshot,
      };
      const cinemas = new Map();
      for (const s of screenings) {
        if (!cinemas.has(s.cinema_id)) cinemas.set(s.cinema_id, []);
        cinemas.get(s.cinema_id).push(s);
      }
      return `<section class="screening-group"><div class="film-group-header"><a href="#/film/${esc(fid)}" aria-label="${tx("About", "关于")} ${esc(filmTitle(film))}">${poster(film, true)}</a><div class="film-group-copy"><div class="film-meta"><span class="badge orange">${tx("Now showing", "正在热映")}</span><span>${esc(film.duration_minutes)} ${tx("min", "分钟")}</span>${film.genres?.map((g) => `<span class="meta-sep">·</span><span>${esc(genreName(g))}</span>`).join("") || ""}</div><h2 style="margin-top:12px"><a href="#/film/${esc(fid)}">${esc(filmTitle(film))}</a></h2><p class="film-excerpt">${esc(filmSynopsis(film) || tx("Find your screening and make it a movie night.", "找到场次，把今晚留给大银幕。"))}</p><div class="film-meta">${filmRating(film)}<span class="meta-sep">·</span><a class="button link small" href="#/film/${esc(fid)}">${tx("Film details", "影片详情")} ${icon("chevron")}</a></div></div></div>${[
        ...cinemas,
      ]
        .map(([cid, list]) => {
          const cinema = bootstrap.cinemas.find((c) => c.id === cid);
          return `<div class="cinema-session"><div class="cinema-title"><h3>${esc(cinema?.name || list[0].cinema_name)}</h3><span class="badge">${esc(screenName(list[0].screen_type))}</span></div><div class="cinema-address">${icon("pin")}${esc(cinema?.address || tx("Beijing", "北京"))}</div><div class="session-list">${list.map((s) => sessionCard(s, cinema, source, fareType)).join("")}</div></div>`;
        })
        .join("")}</section>`;
    })
    .join("");
}
export async function renderDiscover(ctx) {
  const { root, api, bootstrap, params, user, navigate } = ctx;
  let f = filtersFrom(params),
    source = null;
  if (params.get("source_booking_id")) {
    if (!user) {
      navigate("#/login?next=" + encodeURIComponent(location.hash));
      return;
    }
    source = await api.request(
      "/ui/bookings/" + encodeURIComponent(params.get("source_booking_id")),
    );
    if (source.status !== "CONFIRMED")
      throw new Error(
        tx(
          "Only a currently confirmed order can be rescheduled.",
          "只有当前已出票的订单可以改签。",
        ),
      );
    const cinema = bootstrap.cinemas.find((c) => c.id === source.cinema_id);
    f = {
      ...f,
      cinema_id: source.cinema_id,
      film_id: source.film_id,
      party_size: String(source.tickets.length),
      district_id: cinema?.district_id || "",
    };
    delete f.genre_id;
  }
  const query = new URLSearchParams(f);
  if (source) query.set("exclude_screening_id", source.screening_id);
  const data = await api.request("/screenings?" + query);
  const { items } = data;
  const dates = [
    ...new Set([
      beijingDate(),
      beijingDate(1),
      beijingDate(2),
      ...bootstrap.available_dates.slice(0, 3),
    ]),
  ]
    .sort()
    .slice(0, 6);
  let disposeCarousel;
  function render() {
    const previous = root.querySelector("#search-form");
    const draft = previous ? Object.fromEntries(new FormData(previous)) : null;
    const advancedOpen = previous?.querySelector(".search-advanced").open;
    const activeFilmId = root.querySelector("[data-featured-slide].is-active")?.dataset.featuredFilmId;
    disposeCarousel?.();
    const catalogue = !source && !params.toString() ? renderCatalogue(bootstrap, f, activeFilmId) : "";
    const sourceTitle = source && filmTitle(bootstrap.films.find((film) => film.id === source.film_id) || { title: source.film_title });
    const headingTag = catalogue ? "h2" : "h1";
    const pageCount = Math.ceil(data.total / data.page_size);
    const resultCount = data.total
      ? tx(
          `${data.total}${source ? " alternative" : ""} screening${data.total === 1 ? "" : "s"}`,
          `${data.total} 场${source ? "可选" : ""}`,
        )
      : tx("No matches", "没有匹配");
    root.innerHTML = `${catalogue}<div class="page-heading showtimes-heading"><div><p class="eyebrow">${source ? tx("A CHANGE OF PLANS", "改签") : tx("ON THE BIG SCREEN · BEIJING", "大银幕 · 北京")}</p><${headingTag}>${source ? tx("Find your next screening.", "找到下一场。") : tx("Find your next screening", "找到下一场")}</${headingTag}><p class="muted">${source ? tx("Choose a new time. Your current tickets stay valid until the change is confirmed.", "选择新的时间。在改签确认之前，原来的票仍然有效。") : tx("The right film. Your favourite cinema. A seat for everyone.", "合适的影片。熟悉的影院。每个人都有座位。")}</p></div><span class="live-note"><span class="live-dot"></span>${tx("Live seat availability · Beijing time", "座位实时可售 · 北京时间")}</span></div>${source ? notice(tx(`Rescheduling ${sourceTitle} at ${source.cinema_name} · ${source.tickets.length} ticket(s). Same film, cinema and fare mix; fees are confirmed before payment.`, `正在改签 ${source.cinema_name} 的《${sourceTitle}》· ${source.tickets.length} 张票。影片、影院和票种保持不变，费用在付款前确认。`)) : ""}<form id="search-form" class="search-panel">${fields(bootstrap, draft ? { ...f, ...draft } : f, source)}</form><div class="quick-dates" aria-label="${tx("Choose screening date", "选择放映日期")}">${dates.map((d) => `<button type="button" class="date-chip ${d === f.date ? "active" : ""}" data-date="${esc(d)}" aria-pressed="${d === f.date}">${dateLabel(d)}${dateLabel(d) !== shortDate(d) ? ` <span class="muted">${shortDate(d)}</span>` : ""}</button>`).join("")}</div><div class="results-heading"><h2>${source ? tx("Choose a new time", "选择新的场次") : tx("Find your screening", "查找场次")}</h2><p>${resultCount} · ${shortDate(f.date)} · ${peopleLabel(f.party_size)}</p></div><div class="browse-grid"><div class="screening-results">${items.length ? renderGroups(items, bootstrap, source, f.fare_type) : empty(tx("No screenings match these plans.", "没有符合这些条件的场次。"), tx("Try another date or adjust your filters. We keep your chosen film, cinema and group size exactly as requested.", "换个日期，或调整筛选。影片、影院和人数会按你的选择保留。"))}${
      !items.length && bootstrap.available_dates.length
        ? `<div class="notice">${tx("Upcoming screening dates:", "即将放映的日期：")} <div class="chips" style="margin-top:10px">${bootstrap.available_dates
            .slice(0, 6)
            .map(
              (d) =>
                `<button class="chip" data-date="${esc(d)}">${shortDate(d)}</button>`,
            )
            .join("")}</div></div>`
        : ""
    }${data.total > data.page_size ? `<nav class="pagination">${data.page > 1 ? `<button class="button ghost" data-page="${data.page - 1}">${tx("Previous", "上一页")}</button>` : ""}<span>${tx(`Page ${data.page} of ${pageCount}`, `第 ${data.page} / ${pageCount} 页`)}</span>${data.page * data.page_size < data.total ? `<button class="button ghost" data-page="${data.page + 1}">${tx("Next", "下一页")}</button>` : ""}</nav>` : ""}</div><aside class="browse-aside"><section class="aside-card"><p class="eyebrow">${icon("spark")} ${tx("A LITTLE HELP CHOOSING", "帮你挑一场")}</p><h3>${tx("Your kind of film.<br>Your kind of seat.", "你想看的电影。<br>你想坐的位置。")}</h3><p>${tx("Tell us the time, screen and seats you prefer. We'll find options that fit your plans.", "告诉我们时间、厅型和座位。我们按你的安排来找。")}</p><button type="button" data-open-assistant class="button secondary wide">${tx("Ask the assistant", "问问助手")} ${icon("spark")}</button><p class="fine-print" style="margin:12px 0 0">${tx("Live recommendations. You make the final choice.", "推荐是实时的。最后由你决定。")}</p></section><section class="aside-note"><h3>${tx("From browsing to the big screen", "从浏览到大银幕")}</h3><div class="number-step"><span>1</span>${tx("Choose your cinema and showtime.", "选择影院和场次。")}</div><div class="number-step"><span>2</span>${tx("Pick seats. We'll hold them for up to 5 minutes.", "选座。我们最多为你保留 5 分钟。")}</div><div class="number-step"><span>3</span>${tx("Review the price, then confirm your tickets.", "核对价格，然后确认出票。")}</div></section></aside></div>`;
    const form = root.querySelector("#search-form");
    if (previous) form.querySelector(".search-advanced").open = advancedOpen;
    bindCinemaFilter(form, bootstrap, source);
    const go = (changes = {}) => {
      if (!form.reportValidity()) return;
      const next = { ...formFilters(form), ...changes };
      if (f.page_size) next.page_size = f.page_size;
      if (source) next.source_booking_id = source.id;
      navigate("#/discover?" + new URLSearchParams(next));
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      go();
    };
    root
      .querySelectorAll("[data-date]")
      .forEach((b) => (b.onclick = () => go({ date: b.dataset.date })));
    root
      .querySelectorAll("[data-page]")
      .forEach((b) => (b.onclick = () => go({ page: b.dataset.page })));
    disposeCarousel = bindFeaturedCarousel(root);
  }
  ctx.updateLanguage = render;
  render();
  return () => disposeCarousel?.();
}
export const renderCinemas = renderCinemaMap;
export async function renderFilm(ctx, fid) {
  const { root, api } = ctx;
  const film = await api.request("/films/" + encodeURIComponent(fid));
  ctx.updateLanguage = () => {
    root.innerHTML = `<div class="breadcrumb"><a href="#/discover">${tx("Movies & showtimes", "影片与场次")}</a>${icon("chevron")}<span>${tx("Film details", "影片详情")}</span></div><div class="film-detail">${poster(film)}<div class="film-detail-copy"><p class="eyebrow">${film.archived ? tx("FROM THE CATALOGUE", "片单中") : tx("NOW SHOWING", "正在热映")}</p><h1>${esc(filmTitle(film))}</h1><div class="film-meta"><span>${film.duration_minutes} ${tx("min", "分钟")}</span>${film.genres.map((g) => `<span class="meta-sep">·</span><span>${esc(genreName(g))}</span>`).join("")}<span class="meta-sep">·</span><a class="rating" href="#/reviews/film/${esc(fid)}">${filmRating(film)}</a></div><p class="synopsis">${esc(filmSynopsis(film))}</p><div class="community-actions"><a class="button" href="#/discover?film_id=${esc(fid)}">${tx("Find showtimes", "查找场次")} ${icon("arrow")}</a><a class="button ghost" href="#/reviews/film/${esc(fid)}">${tx("Reviews & discussions", "影评与讨论")}</a></div><div class="film-community-entry"><p class="eyebrow">${tx("BEYOND THE CREDITS", "片尾之后")}</p><h3>${tx("What's your take?", "你怎么看？")}</h3><p>${tx("Give it a few stars, write a short review, or join the conversation. No booking required.", "打几颗星，写一条短评，或者加入讨论。不需要先订票。")}</p><a class="community-text-button" href="#/reviews/film/${esc(fid)}">${tx("Rate this film", "为这部影片评分")} ${icon("arrow")}</a></div></div></div>`;
  };
  ctx.updateLanguage();
}

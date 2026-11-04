import { renderCatalogue } from "./catalogue.js";
import { bindFeaturedCarousel } from "./featured-carousel.js";
import { filmRating } from "./film-rating.js";
import { renderCinemaMap } from "./cinema-map.js";
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
function filtersFrom(params) {
  const f = { date: beijingDate(), party_size: "1" };
  for (const name of allowed) if (params.get(name)) f[name] = params.get(name);
  return f;
}
const shortDate = (value) =>
  new Intl.DateTimeFormat("en-GB", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value + "T12:00:00+08:00"));
function dateLabel(value) {
  return value === beijingDate()
    ? "Today"
    : value === beijingDate(1)
      ? "Tomorrow"
      : shortDate(value);
}
function fields(bootstrap, f, source, compact = false) {
  const cinemas = bootstrap.cinemas.filter(
    (c) => c.is_active && (!f.district_id || c.district_id === f.district_id),
  );
  const fixed = source ? "disabled" : "";
  return `${source ? `<input type="hidden" name="cinema_id" value="${esc(source.cinema_id)}"><input type="hidden" name="film_id" value="${esc(source.film_id)}"><input type="hidden" name="party_size" value="${source.tickets.length}">` : ""}<div class="${compact ? "form-grid" : "search-main"}"><label class="field"><span>District</span><select name="district_id" ${source ? "disabled" : ""}>${options(bootstrap.districts, f.district_id, "name", "All Beijing")}</select></label><label class="field"><span>Cinema</span><select name="cinema_id" ${fixed}>${options(cinemas, f.cinema_id, "name", "All cinemas")}</select></label><label class="field"><span>Date</span><input name="date" type="date" value="${esc(f.date)}" required></label><label class="field"><span>People</span><select name="party_size" ${fixed}>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${String(i + 1) === String(f.party_size) ? "selected" : ""}>${i + 1} ${i === 0 ? "person" : "people"}</option>`).join("")}</select></label>${compact ? "" : `<button class="button" type="submit">${icon("search")} Find showtimes</button>`}</div><${compact ? "div" : "details"} class="${compact ? "form-grid" : "search-advanced"}" ${!compact && (f.film_id || f.genre_id || f.zone || f.screen_type || f.start_from) ? "open" : ""}>${compact ? "" : '<summary><span>Film, screen & seat preferences</span><span>＋</span></summary><div class="form-grid three">'}<label class="field"><span>Film</span><select name="film_id" ${fixed}>${options(bootstrap.films, f.film_id, "title", "All films")}</select></label><label class="field"><span>Genre</span><select name="genre_id" ${source ? "disabled" : ""}>${options(bootstrap.genres, f.genre_id, "name", "Any genre")}</select></label><label class="field"><span>Screen type</span><select name="screen_type">${options(
    [
      { id: "STANDARD", name: "Standard" },
      { id: "IMAX", name: "IMAX" },
      { id: "DOLBY_CINEMA", name: "Dolby Cinema" },
    ],
    f.screen_type,
    "name",
    "Any screen",
  )}</select></label><label class="field"><span>Start after</span><input name="start_from" type="time" value="${esc(f.start_from || "")}"></label><label class="field"><span>Start before</span><input name="start_to" type="time" value="${esc(f.start_to || "")}"></label><label class="field"><span>Seat preference</span><select name="zone">${options(
    [
      { id: "FRONT", name: "Front" },
      { id: "MIDDLE", name: "Middle" },
      { id: "REAR", name: "Rear" },
    ],
    f.zone,
    "name",
    "No preference",
  )}</select></label>${compact ? "" : "</div>"}</${compact ? "div" : "details"}>${compact ? `<button class="button wide" type="submit">Find my screening ${icon("arrow")}</button>` : ""}`;
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
      "All cinemas",
    );
  });
}
function formFilters(form) {
  const result = {};
  for (const [key, value] of new FormData(form))
    if (value && allowed.includes(key)) result[key] = String(value);
  return result;
}
function seatLink(screening, source) {
  const params = new URLSearchParams({
    party_size: String(screening.suggestion.seat_ids.length),
    seat_ids: screening.suggestion.seat_ids.join(","),
  });
  if (source) params.set("source_booking_id", source.id);
  return `#/seats/${screening.id}?${params}`;
}
function renderGroups(items, bootstrap, source) {
  const groups = new Map();
  for (const s of items) {
    if (source && s.id === source.screening_id) continue;
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
      return `<section class="screening-group"><div class="film-group-header"><a href="#/film/${esc(fid)}" aria-label="About ${esc(film.title)}">${poster(film, true)}</a><div class="film-group-copy"><div class="film-meta"><span class="badge orange">Now showing</span><span>${esc(film.duration_minutes)} min</span>${film.genres?.map((g) => `<span class="meta-sep">·</span><span>${esc(g.name)}</span>`).join("") || ""}</div><h2 style="margin-top:12px"><a href="#/film/${esc(fid)}">${esc(film.title)}</a></h2><p class="film-excerpt">${esc(film.synopsis || "Find your screening and make it a movie night.")}</p><div class="film-meta">${filmRating(film)}<span class="meta-sep">·</span><a class="button link small" href="#/film/${esc(fid)}">Film details ${icon("chevron")}</a></div></div></div>${[
        ...cinemas,
      ]
        .map(([cid, list]) => {
          const cinema = bootstrap.cinemas.find((c) => c.id === cid);
          return `<div class="cinema-session"><div class="cinema-title"><h3>${esc(cinema?.name || list[0].cinema_name)}</h3><span class="badge">${esc(screenName(list[0].screen_type))}</span></div><div class="cinema-address">${icon("pin")}${esc(cinema?.address || "Beijing")}</div><div class="session-list">${list.map((s) => `<a class="session-button" href="${seatLink(s, source)}" aria-label="${esc(timeOnly(s.starts_at))} at ${esc(cinema?.name || s.cinema_name)}, choose seats"><span class="session-time">${timeOnly(s.starts_at)}</span><span class="session-price">${money(s.fares.find((f) => f.fare_type === "STANDARD")?.price_minor || s.fares[0]?.price_minor)}</span><span class="session-end">Ends ${timeOnly(s.ends_at)}</span><span class="session-screen">${esc(screenName(s.screen_type))} · ${esc(s.screen_name)}</span><span class="session-availability">${icon("check")}${s.suggestion.adjacent ? "Seats together available" : "Separate seats suggested"} · ${s.available_count} left</span></a>`).join("")}</div></div>`;
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
      throw new Error("Only a currently confirmed order can be rescheduled.");
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
  const data = await api.request("/screenings?" + query);
  const items = source
    ? data.items.filter((s) => s.id !== source.screening_id)
    : data.items;
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
  const catalogue = !source && !params.toString() ? renderCatalogue(bootstrap, f) : "";
  const headingTag = catalogue ? "h2" : "h1";
  root.innerHTML = `${catalogue}<div class="page-heading showtimes-heading"><div><p class="eyebrow">${source ? "A CHANGE OF PLANS" : "ON THE BIG SCREEN · BEIJING"}</p><${headingTag}>${source ? "Find your next screening." : "Find your next screening"}</${headingTag}><p class="muted">${source ? "Choose a new time. Your current tickets stay valid until the change is confirmed." : "The right film. Your favourite cinema. A seat for everyone."}</p></div><span class="live-note"><span class="live-dot"></span>Live seat availability · Beijing time</span></div>${source ? notice(`Rescheduling ${source.film_title} at ${source.cinema_name} · ${source.tickets.length} ticket(s). Same film, cinema and fare mix; fees are confirmed before payment.`) : ""}<form id="search-form" class="search-panel">${fields(bootstrap, f, source)}</form><div class="quick-dates" aria-label="Choose screening date">${dates.map((d) => `<button type="button" class="date-chip ${d === f.date ? "active" : ""}" data-date="${esc(d)}" aria-pressed="${d === f.date}">${dateLabel(d)}${dateLabel(d) !== shortDate(d) ? ` <span class="muted">${shortDate(d)}</span>` : ""}</button>`).join("")}</div><div class="results-heading"><h2>${source ? "Choose a new time" : "Find your screening"}</h2><p>${items.length ? `${data.total}${source ? " total" : ""} screenings` : "No matches"} · ${shortDate(f.date)} · ${Number(f.party_size)} ${Number(f.party_size) === 1 ? "person" : "people"}</p></div><div class="browse-grid"><div class="screening-results">${items.length ? renderGroups(items, bootstrap, source) : empty("No screenings match these plans.", "Try another date or adjust your filters. We keep your chosen film, cinema and group size exactly as requested.")}${
    !items.length && bootstrap.available_dates.length
      ? `<div class="notice">Upcoming screening dates: <div class="chips" style="margin-top:10px">${bootstrap.available_dates
          .slice(0, 6)
          .map(
            (d) =>
              `<button class="chip" data-date="${esc(d)}">${shortDate(d)}</button>`,
          )
          .join("")}</div></div>`
      : ""
  }${data.total > data.page_size ? `<nav class="pagination">${data.page > 1 ? `<button class="button ghost" data-page="${data.page - 1}">Previous</button>` : ""}<span>Page ${data.page} of ${Math.ceil(data.total / data.page_size)}</span>${data.page * data.page_size < data.total ? `<button class="button ghost" data-page="${data.page + 1}">Next</button>` : ""}</nav>` : ""}</div><aside class="browse-aside"><section class="aside-card"><p class="eyebrow">${icon("spark")} A LITTLE HELP CHOOSING</p><h3>Your kind of film.<br>Your kind of seat.</h3><p>Tell us the time, screen and seats you prefer. We'll find options that fit your plans.</p><button type="button" data-open-assistant class="button secondary wide">Ask the assistant ${icon("spark")}</button><p class="fine-print" style="margin:12px 0 0">Live recommendations. You make the final choice.</p></section><section class="aside-note"><h3>From browsing to the big screen</h3><div class="number-step"><span>1</span>Choose your cinema and showtime.</div><div class="number-step"><span>2</span>Pick seats. We'll hold them for up to 5 minutes.</div><div class="number-step"><span>3</span>Review the price, then confirm your tickets.</div></section></aside></div>`;
  const form = root.querySelector("#search-form");
  bindCinemaFilter(form, bootstrap, source);
  const go = (changes = {}) => {
    const next = { ...formFilters(form), ...changes };
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
  return bindFeaturedCarousel(root);
}
export const renderCinemas = renderCinemaMap;
export async function renderFilm(ctx, fid) {
  const { root, api, user, navigate } = ctx;
  const film = await api.request("/films/" + encodeURIComponent(fid));
  root.innerHTML = `<div class="breadcrumb"><a href="#/discover">Movies & showtimes</a>${icon("chevron")}<span>Film details</span></div><div class="film-detail">${poster(film)}<div class="film-detail-copy"><p class="eyebrow">${film.archived ? "FROM THE CATALOGUE" : "NOW SHOWING"}</p><h1>${esc(film.title)}</h1><div class="film-meta"><span>${film.duration_minutes} min</span>${film.genres.map((g) => `<span class="meta-sep">·</span><span>${esc(g.name)}</span>`).join("")}<span class="meta-sep">·</span><span class="rating">${filmRating(film)}</span></div><p class="synopsis">${esc(film.synopsis)}</p><a class="button" href="#/discover?film_id=${esc(fid)}">Find showtimes ${icon("arrow")}</a><div class="rating-form"><h3>How was the film?</h3><p class="muted" style="font-size:12px">Rate this film from 1 to 10. Your rating contributes to the overall score. No booking required.</p>${user?.role === "CUSTOMER" ? `<form id="rating-form"><div class="rating-stars" role="group" aria-label="Your rating">${Array.from({ length: 10 }, (_, i) => i + 1).map((n) => `<label><input type="radio" name="stars" value="${n}" required aria-label="${n} ${n === 1 ? "point" : "points"}"><span>${n}</span></label>`).join("")}</div><div class="form-error"></div><button class="button ghost small" type="submit" style="margin-top:14px">Save my rating</button></form>` : user ? '<p class="muted">Ratings are available to customer accounts.</p>' : `<a class="button ghost" href="#/login?next=${encodeURIComponent(location.hash)}">Sign in to rate</a>`}</div></div></div>`;
  root
    .querySelector("#rating-form")
    ?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await busy(form.querySelector("[type=submit]"), async () => {
        try {
          await api.request("/films/" + fid + "/rating", {
            method: "PUT",
            body: { stars: Number(new FormData(form).get("stars")) },
          });
          ctx.toast("Your rating has been saved.");
          await ctx.refresh();
          ctx.route();
        } catch (e) {
          showError(form.querySelector(".form-error"), e);
        }
      });
    });
}

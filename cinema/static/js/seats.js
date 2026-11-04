import {
  esc,
  money,
  dateTime,
  timeOnly,
  screenName,
  poster,
  icon,
  notice,
  empty,
  busy,
  showError,
} from "./ui.js";

function readDraft(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key));
  } catch {
    return null;
  }
}
const seatLabel = (s) => `Row ${s.row_no} · Seat ${s.seat_no}`;
const fareLabel = (f) => (f === "STUDENT" ? "Student" : "Standard");
async function allRows(api, path) {
  const result = [];
  let page = 1;
  while (true) {
    const data = await api.request(`${path}?page=${page}&page_size=100`);
    result.push(...data.items);
    if (result.length >= data.total || !data.items.length) break;
    page++;
  }
  return result;
}

export async function renderSeats(ctx, sid) {
  const { root, api, user, bootstrap, params, navigate, toast } = ctx;
  let alive = true,
    interval;
  let map = await api.request(
    "/screenings/" + encodeURIComponent(sid) + "/seats",
  );
  const s = map.screening;
  const film =
    bootstrap.films.find((f) => f.id === s.film_id) ||
    (await api.request("/films/" + s.film_id));
  const cinema = bootstrap.cinemas.find((c) => c.id === s.cinema_id);
  let offset = new Date(map.as_of).getTime() - Date.now();
  const draftKey = `falcons.checkout.${user?.id || "guest"}.${sid}`;
  let draft = readDraft(draftKey);
  const state = {
    phase: "choose",
    selected: new Set(),
    hold: null,
    quote: null,
    fares: {},
    coupon_id: null,
    source: null,
    target: Math.min(
      12,
      Math.max(1, Math.trunc(Number(params.get("party_size"))) || 1),
    ),
    error: null,
    receipt: null,
    counterBundle: null,
  };
  const customer = user?.role === "CUSTOMER";
  let holdId = params.get("hold_id");
  let coupons = [];
  if (customer) {
    const holds = await allRows(api, "/me/holds");
    coupons = (await allRows(api, "/me/coupons")).filter(
      (c) => c.cinema_id === s.cinema_id && c.status === "AVAILABLE",
    );
    const pending = draft?.hold_id && api.pending?.("pay:" + draft.hold_id);
    if (pending && draft.quote) {
      holdId = draft.hold_id;
      state.phase = "recover";
      state.quote = draft.quote;
    }
    const h = holds.find((h) => h.id === holdId);
    if (holdId && !h)
      throw new Error(
        "This seat hold is unavailable for your account. Please choose seats again.",
      );
    if (h && h.screening_id !== sid)
      throw new Error(
        "This seat hold belongs to a different screening. Open the hold from My tickets to continue.",
      );
    if (h) {
      state.hold = h;
      state.selected = new Set(
        state.phase === "recover" && h.status === "CONVERTED"
          ? (draft?.tickets || []).map((t) => t.seat_id)
          : h.seat_ids,
      );
      state.target = h.seat_ids.length || draft?.tickets?.length || 1;
      if (state.phase !== "recover")
        state.phase =
          h.effective_status === "ACTIVE"
            ? "held"
            : h.status === "CONVERTED"
              ? "converted"
              : "expired";
      if (draft?.hold_id === h.id) {
        state.fares = Object.fromEntries(
          (draft.tickets || []).map((t) => [t.seat_id, t.fare_type]),
        );
        state.coupon_id = draft.coupon_id || null;
        if (state.phase === "held" && draft.quote) {
          state.quote = draft.quote;
          state.phase = "quoted";
        }
      }
    }
  }
  const sourceId = state.hold
    ? state.hold.source_booking_id
    : params.get("source_booking_id");
  if (sourceId) {
    if (!customer) {
      navigate("#/login?next=" + encodeURIComponent(location.hash));
      return;
    }
    state.source = await api.request(
      "/ui/bookings/" + encodeURIComponent(sourceId),
    );
    state.target = state.source.tickets.length;
  }
  function validateQuote(q) {
    if (
      q.hold_id !== state.hold?.id ||
      q.screening_id !== sid ||
      q.owner_id !== user.id ||
      (q.source_booking_id || null) !== (state.source?.id || null)
    )
      throw new Error(
        "This quote does not match the displayed screening and booking. Open your seat hold from My tickets.",
      );
  }
  if (state.quote) validateQuote(state.quote);
  if (state.phase === "choose")
    for (const id of (params.get("seat_ids") || "").split(",")) {
      const seat = map.seats.find((v) => v.id === id);
      if (
        seat &&
        (seat.state === "AVAILABLE" || seat.held_by_me) &&
        state.selected.size < state.target
      )
        state.selected.add(id);
    }
  if (params.get("from") === "assistant" && state.phase === "choose") {
    const suggested = (params.get("seat_ids") || "").split(",").filter(Boolean);
    if (suggested.some((id) => !state.selected.has(id)))
      state.error = "Some suggested seats are no longer available. Please review the latest map and complete your selection. No new seats have been held.";
  }
  async function lockWhile(action) {
    if (state.working) return;
    state.working = true;
    const controls = [
      ...root.querySelectorAll("button,input,select,textarea"),
    ].map((el) => [el, el.disabled]);
    controls.forEach(([el]) => (el.disabled = true));
    try {
      return await action();
    } finally {
      state.working = false;
      controls.forEach(([el, disabled]) => {
        if (el.isConnected) el.disabled = disabled;
      });
      tick();
    }
  }
  function selectedSeats() {
    return map.seats.filter((seat) => state.selected.has(seat.id));
  }
  function tickets() {
    const original = state.source?.tickets || [];
    return selectedSeats().map((seat, i) => ({
      seat_id: seat.id,
      fare_type: state.fares[seat.id] || original[i]?.fare_type || "STANDARD",
    }));
  }
  function save() {
    if (state.hold)
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          hold_id: state.hold.id,
          screening_id: sid,
          tickets: tickets(),
          coupon_id: state.coupon_id,
          quote: state.quote,
        }),
      );
  }
  function remaining() {
    return state.hold
      ? Math.max(
          0,
          new Date(state.hold.expires_at).getTime() - Date.now() - offset,
        )
      : 0;
  }
  function payPending() {
    return state.hold && api.pending?.("pay:" + state.hold.id);
  }
  function grid() {
    const seats = map.seats;
    const x = Math.max(...seats.map((t) => t.map_x)) + 1;
    const labels = new Map();
    for (const t of seats) {
      if (!labels.has(t.map_y)) labels.set(t.map_y, new Set());
      labels.get(t.map_y).add(t.row_no);
    }
    const direction = map.layout.screen_direction.toLowerCase();
    return `<div class="seat-scroll"><div class="auditorium"><div class="screen-line ${direction}">SCREEN · ${esc(screenName(map.screening.screen_type || "STANDARD"))}</div><div class="seat-grid" role="group" aria-label="Seats, rows numbered nearest to furthest from the screen" style="grid-template-columns:24px repeat(${x},var(--seat-size,34px))">${[...labels].map(([y, nums]) => `<span class="row-label" aria-hidden="true" style="grid-column:1;grid-row:${y + 1}">${nums.size === 1 ? [...nums][0] : ""}</span>`).join("")}${seats
      .map((seat) => {
        const selected = state.selected.has(seat.id);
        const selectable =
          state.phase === "choose" &&
          (seat.state === "AVAILABLE" || seat.held_by_me) &&
          s.status === "PUBLISHED";
        return `<button type="button" class="seat ${seat.state === "SOLD" ? "sold" : ""} ${seat.state === "HELD" && !selected ? "held" : ""}" style="grid-column:${seat.map_x + 2};grid-row:${seat.map_y + 1}" data-seat="${esc(seat.id)}" aria-label="${esc(seatLabel(seat))}, ${selected ? "selected" : seat.state === "AVAILABLE" ? "available" : seat.held_by_me ? "held by you" : seat.state.toLowerCase()}, ${seat.zone.toLowerCase()} zone" aria-pressed="${selected}" title="${esc(seatLabel(seat))} · ${seat.zone.toLowerCase()}" ${selectable ? "" : "disabled"}>${seat.seat_no}</button>`;
      })
      .join("")}</div></div></div>`;
  }
  function paymentSummary() {
    const q = state.quote;
    if (!q) return "";
    return `<div class="summary-line"><span>Full ticket price</span><strong>${money(q.gross_ticket_minor)}</strong></div>${q.price_factor_bps === 5000 ? `<div class="summary-line"><span>50% ticket discount</span><strong>−${money(q.gross_ticket_minor - q.net_ticket_minor)}</strong></div>` : ""}<div class="summary-line"><span>Net ticket value</span><strong>${money(q.net_ticket_minor)}</strong></div>${state.source ? `<div class="summary-line"><span>Previous ticket value</span><strong>−${money(state.source.net_ticket_minor)}</strong></div><div class="summary-line"><span>Change fee (${q.fee_rate_bps / 100}%)</span><strong>${money(q.current_fee_minor)}</strong></div><div class="summary-line"><span>Fees across this booking chain</span><strong>${money(q.cumulative_fee_minor)}</strong></div>` : ""}<div class="summary-line summary-total"><span>${q.amount_due_minor < 0 ? "Returned to your balance" : q.amount_due_minor === 0 ? "No balance movement" : "Due now"}</span><strong>${money(Math.abs(q.amount_due_minor))}</strong></div>`;
  }
  function chosenTags() {
    return `<div class="summary-seats">${
      selectedSeats()
        .map(
          (seat) =>
            `<span class="seat-tag">R${seat.row_no} · S${seat.seat_no}</span>`,
        )
        .join("") ||
      '<span class="muted" style="font-size:12px">No seats selected yet</span>'
    }</div>`;
  }
  function counterSelection() {
    return customer && state.phase === "choose"
      ? `<details class="consent-box"><summary>Booking at a cinema counter?</summary><p class="fine-print">You can approve a specific employee to hold these seats for you. This approval cannot charge your balance.</p><form id="hold-consent-form"><label class="field"><span>Staff ID provided at the counter</span><input name="staff_id" inputmode="numeric" pattern="[0-9]+" required></label><button type="submit" class="button ghost small" style="margin-top:12px" ${state.selected.size !== state.target ? "disabled" : ""}>Approve seat hold</button><div class="form-error"></div></form><div class="token-output" id="hold-consent-output"></div></details>`
      : "";
  }
  function counterPayment() {
    return customer && state.phase === "quoted" && !payPending()
      ? `<details class="consent-box"><summary>Let counter staff complete this purchase</summary><p class="fine-print">Only the named employee can use your approval, for this exact quote and seat hold.</p><form id="pay-consent-form"><label class="field"><span>Staff ID</span><input name="staff_id" inputmode="numeric" pattern="[0-9]+" required></label><button type="submit" class="button ghost small" style="margin-top:12px">Approve ${state.quote.amount_due_minor < 0 ? "refund difference" : "payment"} at counter</button><div class="form-error"></div></form><div class="token-output" id="pay-consent-output"></div></details>`
      : "";
  }
  function render() {
    if (!alive) return;
    if (state.phase === "complete") {
      renderSuccess();
      return;
    }
    const isHeld = ["held", "quoted", "recover"].includes(state.phase);
    const source = state.source;
    root.innerHTML = `<div class="breadcrumb"><a href="#/discover${source ? "?source_booking_id=" + esc(source.id) : ""}">Showtimes</a>${icon("chevron")}<span>${esc(film.title)}</span></div><div class="booking-progress"><span class="${state.phase === "choose" ? "active" : ""}"><b>1</b>Choose seats</span><i class="rule"></i><span class="${isHeld ? "active" : ""}"><b>2</b>Review & confirm</span><i class="rule"></i><span><b>3</b>Your tickets</span></div><div class="page-heading"><div><p class="eyebrow">${source ? "RESCHEDULE YOUR WHOLE BOOKING" : "A GOOD NIGHT STARTS WITH A GOOD SEAT"}</p><h1>${state.phase === "recover" ? "Let’s confirm your booking." : isHeld ? "Your seats are on hold." : "Choose your seats."}</h1></div><span class="live-note">${dateTime(s.starts_at)} · Beijing time</span></div>${source ? notice(`Changing ${source.tickets.length} ticket(s) from ${dateTime(source.starts_at)}. Your original booking stays valid until this change completes.`) : ""}<div id="seat-errors">${state.error ? notice(state.error, "error") : ""}</div>${s.status !== "PUBLISHED" || new Date(s.starts_at).getTime() <= Date.now() + offset ? notice("This screening is no longer on sale. Please choose another showtime.", "warning") : ""}<div class="seat-layout"><section class="seat-panel"><div class="panel-header"><div><h2>${esc(cinema?.name || "Cinema")} <span class="muted" style="font-size:13px;font-weight:400">· ${esc(s.screen_name || "Screen")} · ${esc(screenName(map.screening.screen_type || "STANDARD"))}</span></h2><p class="muted" style="font-size:12px;margin:7px 0 0">${esc(cinema?.address || "Beijing")} · ${dateTime(s.starts_at)}</p></div><button class="button ghost small" id="refresh-map" aria-label="Refresh seat availability">Refresh</button></div><div class="seat-legend"><span><i class="legend-box"></i>Available</span><span><i class="legend-box selected"></i>Your selection</span><span><i class="legend-box held"></i>On hold</span><span><i class="legend-box sold"></i>Sold</span></div>${grid()}<p class="seat-help">Rows count from the screen. Gaps mark aisles. Scroll the map sideways if needed, or use Tab and Enter.</p>${isHeld ? notice("These seats are reserved until the countdown ends. Refreshing does not extend the hold.") : ""}</section><aside class="panel booking-summary"><div class="summary-film">${poster(film, true)}<div><h3>${esc(film.title)}</h3><p>${s.duration_minutes_snapshot ?? film.duration_minutes} min · ${esc(timeOnly(s.starts_at))}–${esc(timeOnly(s.ends_at))}</p></div></div><div class="summary-line"><span>Cinema</span><strong>${esc(cinema?.name || "Beijing")}</strong></div><div class="summary-line"><span>Date</span><strong>${dateTime(s.starts_at, { hour: undefined, minute: undefined })}</strong></div>${state.phase === "choose" ? `<label class="field" style="margin-top:16px"><span>Number of tickets</span><select id="party-size" ${source ? "disabled" : ""}>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === state.target ? "selected" : ""}>${i + 1} ${i === 0 ? "ticket" : "tickets"}</option>`).join("")}</select></label>` : ""}${chosenTags()}${isHeld ? `<div class="hold-clock">${icon("clock")}<span>Seats held for</span><strong id="countdown">—</strong></div>` : ""}<div id="checkout-controls">${controls()}</div>${counterSelection()}${counterPayment()}</aside></div>`;
    root.querySelectorAll("[data-seat]").forEach(
      (button) =>
        (button.onclick = () => {
          const id = button.dataset.seat;
          if (state.selected.has(id)) state.selected.delete(id);
          else if (state.selected.size < state.target) state.selected.add(id);
          else {
            toast(
              `Choose up to ${state.target} seats, or change the ticket count.`,
              "error",
            );
            return;
          }
          state.error = null;
          render();
          root
            .querySelector(`[data-seat="${id}"]`)
            ?.focus({ preventScroll: true });
        }),
    );
    root.querySelector("#party-size")?.addEventListener("change", (e) => {
      state.target = Number(e.target.value);
      while (state.selected.size > state.target)
        state.selected.delete([...state.selected].pop());
      render();
    });
    root.querySelector("#refresh-map").onclick = (e) =>
      busy(
        e.currentTarget,
        async () => {
          try {
            map = await api.request("/screenings/" + sid + "/seats");
            offset = new Date(map.as_of).getTime() - Date.now();
            if (state.phase === "choose")
              state.selected = new Set(
                [...state.selected].filter((id) =>
                  map.seats.some(
                    (st) =>
                      st.id === id &&
                      (st.state === "AVAILABLE" || st.held_by_me),
                  ),
                ),
              );
            render();
          } catch (err) {
            showError(root.querySelector("#seat-errors"), err);
          }
        },
        "Refreshing…",
      );
    root
      .querySelector("#create-hold")
      ?.addEventListener("click", (e) =>
        busy(e.currentTarget, () => lockWhile(createHold), "Holding seats…"),
      );
    root.querySelector("#quote-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      busy(
        form.querySelector("[type=submit]"),
        () => lockWhile(requestQuote),
        "Getting price…",
      );
    });
    root.querySelectorAll("[data-fare]").forEach(
      (input) =>
        (input.onchange = () => {
          state.fares[input.dataset.fare] = input.value;
          state.quote = null;
          state.phase = "held";
          save();
          render();
        }),
    );
    root.querySelector("#coupon")?.addEventListener("change", (e) => {
      state.coupon_id = e.target.value || null;
      state.quote = null;
      state.phase = "held";
      save();
      render();
    });
    root
      .querySelector("#pay-now")
      ?.addEventListener("click", (e) =>
        busy(
          e.currentTarget,
          () => lockWhile(pay),
          state.phase === "recover" ? "Checking result…" : "Confirming…",
        ),
      );
    root
      .querySelector("#change-seats")
      ?.addEventListener("click", (e) =>
        busy(e.currentTarget, () => lockWhile(release), "Releasing…"),
      );
    root.querySelector("#reselect")?.addEventListener("click", () => {
      sessionStorage.removeItem(draftKey);
      navigate(
        "#/seats/" + sid + (source ? "?source_booking_id=" + source.id : ""),
      );
    });
    root
      .querySelector("#hold-consent-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        await busy(form.querySelector("[type=submit]"), async () => {
          try {
            const data = await api.request("/counter-hold-consents", {
              method: "POST",
              body: {
                staff_id: new FormData(form).get("staff_id"),
                screening_id: sid,
                seat_ids: [...state.selected],
                source_booking_id: source?.id || null,
              },
            });
            showBundle(
              root.querySelector("#hold-consent-output"),
              {
                hold_consent_token: data.hold_consent_token,
                request_key: data.request_key,
              },
              "Seat-hold approval",
              "Give this approval to the employee. Your seats are not held until they submit it.",
            );
          } catch (err) {
            showError(form.querySelector(".form-error"), err);
          }
        });
      });
    root
      .querySelector("#pay-consent-form")
      ?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        await busy(form.querySelector("[type=submit]"), async () => {
          try {
            const data = await api.request(
              "/holds/" + state.hold.id + "/counter-consent",
              {
                method: "POST",
                body: {
                  staff_id: new FormData(form).get("staff_id"),
                  quote_token: state.quote.quote_token,
                },
              },
            );
            showBundle(
              root.querySelector("#pay-consent-output"),
              {
                quote_token: state.quote.quote_token,
                consent_token: data.consent_token,
              },
              "Payment approval",
              `Only the named staff member can complete this ${state.quote.amount_due_minor < 0 ? "refund" : "payment"} of ${money(Math.abs(state.quote.amount_due_minor))}. The seat-hold deadline still applies.`,
            );
          } catch (err) {
            showError(form.querySelector(".form-error"), err);
          }
        });
      });
    tick();
  }
  function controls() {
    if (state.phase === "recover")
      return `${notice("The previous payment response was not confirmed. Check its result before making any further changes. Retrying this action cannot charge you twice.", "warning")}${paymentSummary()}<button class="button wide" id="pay-now">Check payment result ${icon("arrow")}</button><a class="button ghost wide" style="margin-top:10px" href="#/account">View my tickets</a>`;
    if (state.phase === "converted")
      return `${notice("This hold has already been purchased. Your issued tickets are in your account.")}<a class="button wide" href="#/account">View my tickets ${icon("arrow")}</a>`;
    if (state.phase === "expired")
      return `${notice("This seat hold has ended. Your earlier confirmed tickets, if any, remain unchanged.", "warning")}<button class="button wide" id="reselect">Choose seats again</button>`;
    if (state.phase === "choose") {
      const selected = state.selected.size;
      const ticketTotal = tickets().reduce(
        (sum, t) =>
          sum +
          (map.fares.find((f) => f.fare_type === t.fare_type)?.price_minor ||
            0),
        0,
      );
      return `<div class="summary-line"><span>Selected</span><strong>${selected} / ${state.target} seats</strong></div><div class="summary-line summary-total"><span>Face price estimate</span><strong>${money(ticketTotal)}</strong></div><p class="fine-print">Choose ticket types and an eligible coupon at the next step. Any change fee is quoted before confirmation.</p>${!user ? `<a class="button wide" href="#/login?next=${encodeURIComponent("#/seats/" + sid + "?" + new URLSearchParams({ party_size: String(state.target), seat_ids: [...state.selected].join(","), ...(state.source ? { source_booking_id: state.source.id } : {}), ...(params.get("from") === "assistant" ? { from: "assistant" } : {}) }))}">Sign in to hold seats ${icon("arrow")}</a>` : !customer ? `<p class="notice">Customer accounts book here. For assisted sales, open the cinema workspace.</p><a class="button wide" href="#/operations?tab=counter">Open counter sales</a>` : `<button class="button wide" id="create-hold" ${selected !== state.target || s.status !== "PUBLISHED" || new Date(s.starts_at).getTime() <= Date.now() + offset ? "disabled" : ""}>Hold ${selected || "your"} ${selected === 1 ? "seat" : "seats"} ${icon("arrow")}</button>`}<p class="fine-print">A hold lasts up to 5 minutes. Browsing and selecting do not reserve a seat.</p>`;
    }
    return `<form id="quote-form"><div class="fare-choices">${tickets()
      .map((t) => {
        const seat = map.seats.find((st) => st.id === t.seat_id);
        return `<div class="fare-line"><label for="fare-${t.seat_id}">R${seat.row_no} · S${seat.seat_no}</label><select id="fare-${t.seat_id}" data-fare="${t.seat_id}" aria-label="Ticket type for ${esc(seatLabel(seat))}" ${state.source ? "disabled" : ""}>${map.fares.map((f) => `<option value="${f.fare_type}" ${t.fare_type === f.fare_type ? "selected" : ""}>${fareLabel(f.fare_type)} · ${money(f.price_minor)}</option>`).join("")}</select></div>`;
      })
      .join(
        "",
      )}</div>${state.source ? '<p class="fine-print">Your original ticket mix and discount are carried forward.</p>' : `<label class="field" style="margin:18px 0"><span>Coupon</span><select id="coupon"><option value="">No coupon</option>${coupons.map((c) => `<option value="${esc(c.id)}" ${state.coupon_id === c.id ? "selected" : ""}>50% off · coupon ${esc(c.id.slice(-6))}</option>`).join("")}</select><small>Only unused coupons from this cinema apply.</small></label>`}<p class="fine-print">Student eligibility is checked at admission.</p>${state.phase === "quoted" ? `${paymentSummary()}<button class="button wide" type="button" id="pay-now">${state.quote.amount_due_minor < 0 ? "Confirm change & refund " + money(-state.quote.amount_due_minor) : state.quote.amount_due_minor === 0 ? "Confirm change — no payment" : "Pay " + money(state.quote.amount_due_minor) + (state.source ? " & change" : " & book")}${icon("arrow")}</button><p class="fine-print">${state.source ? "Only a successful change releases your old tickets." : "Payment uses your demo wallet balance."} The server verifies the current price and seat hold again.</p>` : `<button class="button wide" type="submit">Review final price ${icon("arrow")}</button>`}</form><button class="button ghost wide small" id="change-seats" style="margin-top:12px">Release hold & change seats</button>`;
  }
  function tick() {
    if (!alive || !state.hold) return;
    const ms = remaining();
    const clock = root.querySelector("#countdown");
    if (clock)
      clock.textContent =
        String(Math.floor(ms / 60000)).padStart(2, "0") +
        ":" +
        String(Math.floor(ms / 1000) % 60).padStart(2, "0");
    if (!state.working && ms <= 0 && ["held", "quoted"].includes(state.phase)) {
      state.phase = payPending() ? "recover" : "expired";
      render();
    }
  }
  async function createHold() {
    try {
      state.error = null;
      const h = await api.action("hold:" + sid, "/holds", {
        screening_id: sid,
        seat_ids: [...state.selected],
        source_booking_id: state.source?.id || null,
      });
      state.hold = { ...h, id: h.hold_id };
      state.phase = "held";
      state.quote = null;
      save();
      params.set("hold_id", h.hold_id);
      history.replaceState(null, "", "#/seats/" + sid + "?" + params);
      map = await api.request("/screenings/" + sid + "/seats");
      render();
      toast("Your seats are on hold. Review ticket types and price.");
    } catch (e) {
      state.error = e.userMessage || e.message;
      if (e.code === "SEAT_UNAVAILABLE") {
        try {
          map = await api.request("/screenings/" + sid + "/seats");
          state.selected = new Set(
            [...state.selected].filter((id) =>
              map.seats.some(
                (t) => t.id === id && (t.state === "AVAILABLE" || t.held_by_me),
              ),
            ),
          );
        } catch {
          /* Keep the original seat conflict visible if refreshing fails. */
        }
      }
      render();
    }
  }
  async function requestQuote() {
    try {
      state.error = null;
      const q = await api.request("/holds/" + state.hold.id + "/quote", {
        method: "POST",
        body: {
          tickets: tickets(),
          coupon_id: state.source ? null : state.coupon_id,
        },
      });
      validateQuote(q);
      state.quote = q;
      state.phase = "quoted";
      save();
      render();
    } catch (e) {
      state.error = e.userMessage || e.message;
      if (["HOLD_EXPIRED", "TOKEN_EXPIRED"].includes(e.code))
        state.phase = "expired";
      render();
    }
  }
  async function release() {
    try {
      await api.request("/holds/" + state.hold.id, { method: "DELETE" });
      sessionStorage.removeItem(draftKey);
      state.hold = null;
      state.quote = null;
      state.phase = "choose";
      state.error = null;
      params.delete("hold_id");
      history.replaceState(null, "", "#/seats/" + sid + "?" + params);
      map = await api.request("/screenings/" + sid + "/seats");
      render();
    } catch (e) {
      state.error = e.userMessage || e.message;
      render();
    }
  }
  async function pay() {
    if (!state.quote) return;
    save();
    try {
      state.error = null;
      state.receipt = await api.action("pay:" + state.hold.id, "/bookings", {
        quote_token: state.quote.quote_token,
      });
      state.phase = "complete";
      sessionStorage.removeItem(draftKey);
      render();
      toast(
        state.source
          ? "Your booking has been changed."
          : "Your tickets are confirmed.",
      );
    } catch (e) {
      state.error = e.userMessage || e.message;
      if (api.pending("pay:" + state.hold.id)) state.phase = "recover";
      else if (["HOLD_EXPIRED", "TOKEN_EXPIRED"].includes(e.code))
        state.phase = "expired";
      else if (e.code === "QUOTE_CHANGED") {
        state.phase = "held";
        state.quote = null;
        save();
      }
      render();
    }
  }
  function renderSuccess() {
    const r = state.receipt;
    root.innerHTML = `<section class="panel success-panel"><div class="success-mark">${icon("check")}</div><p class="eyebrow">${state.source ? "NEW PLANS, CONFIRMED" : "YOU’RE GOING TO THE MOVIES"}</p><h1>${state.source ? "Your booking is changed." : "See you at the cinema."}</h1><p class="muted">${state.source ? "Your old seats have been released and your new tickets are ready." : "Your tickets are confirmed. Find the details in your account anytime."}</p><div class="success-ticket"><span class="badge">Confirmed</span><h2 style="margin-top:15px">${esc(film.title)}</h2><p class="muted" style="font-size:13px">${esc(cinema?.name || "Cinema")} · ${esc(s.screen_name || "Screen")} · ${dateTime(s.starts_at)}</p>${chosenTags()}<div class="summary-line"><span>${r.amount_due_minor < 0 ? "Returned to balance" : "Paid from balance"}</span><strong>${money(Math.abs(r.amount_due_minor))}</strong></div><div class="summary-line"><span>Remaining balance</span><strong>${money(r.balance_minor)}</strong></div><p class="fine-print" style="margin-bottom:0">Booking ${esc(r.booking_id)}</p></div><div class="actions"><a class="button" href="#/account?tab=orders&booking=${esc(r.booking_id)}">View my tickets ${icon("arrow")}</a><a class="button ghost" href="#/discover">Back to showtimes</a></div></section>`;
  }
  function showBundle(container, data, label, description) {
    container.innerHTML = `${notice(description)}<label class="field"><span>${esc(label)}</span><textarea readonly spellcheck="false" aria-label="${esc(label)}">${esc(JSON.stringify(data))}</textarea></label><button class="button ghost small" type="button" style="margin-top:10px">Copy approval</button>`;
    container.querySelector("button").onclick = async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(data));
        toast("Approval copied.");
      } catch {
        container.querySelector("textarea").select();
        toast("Select and copy the approval text.");
      }
    };
  }
  render();
  interval = setInterval(tick, 1000);
  return () => {
    alive = false;
    clearInterval(interval);
  };
}

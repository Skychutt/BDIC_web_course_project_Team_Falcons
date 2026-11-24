import { venueName, venueAddress, auditoriumName } from "./venue-locale.js";
import { seatGrid, seatLabel } from "./seat-grid.js";
import { openTicketCard } from "./ticket-card.js";
import { tx } from "./locale.js";
import { showtimeFilters } from "./showtime-filters.js";
import { rescheduleDeadline, closedReschedule } from "./rescheduling.js";
import { filmTitle } from "./film-locale.js";
import { apiMessage } from "./api.js";
import {
  esc,
  money,
  dateTime,
  timeOnly,
  screenName,
  poster,
  icon,
  notice,
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
const counterSalesUrl = "#/operations?tab=counter";
const seatTag = (s) => tx(`R${s.row_no} · S${s.seat_no}`, `${s.row_no} 排 ${s.seat_no} 座`);
const fareLabel = (f) => f === "STUDENT" ? tx("Student", "学生票") : tx("Standard", "标准票");
async function allRows(api, path, signal) {
  const result = [];
  let page = 1;
  while (true) {
    const data = await api.request(`${path}?page=${page}&page_size=100`, { signal });
    result.push(...data.items);
    if (result.length >= data.total || !data.items.length) break;
    page++;
  }
  return result;
}

export async function renderSeats(ctx, sid) {
  const { root, api, user, bootstrap, params, navigate, toast } = ctx;
  let pageHash = location.hash;
  let alive = true,
    interval, saleTimer, renderedOnSale, renderedChangeClosed;
  let saleCheck, mapRefresh, holdRefresh, closeTicket;
  let locatedSeatId, locateTimer;
  let pendingRender = false;
  let map = await api.request(
    "/screenings/" + encodeURIComponent(sid) + "/seats",
  );
  let offset = new Date(map.as_of).getTime() - Date.now();
  const film =
    bootstrap.films.find((f) => f.id === map.screening.film_id) ||
    (await api.request("/films/" + map.screening.film_id));
  const cinema = bootstrap.cinemas.find((c) => c.id === map.screening.cinema_id);
  const draftKey = `falcons.checkout.${user?.id || "guest"}.${sid}`;
  let draft = readDraft(draftKey);
  let checkDelay = 2000;
  let nextResultCheck = Date.now() + checkDelay;
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
    seatConflict: null,
    receipt: null,
    allowPaymentRetry: false,
  };
  const customer = user?.role === "CUSTOMER";
  let holdId = params.get("hold_id");
  let coupons = [];
  let couponStatus = "idle";
  if (customer) {
    const pending = draft?.hold_id && api.pending?.("pay:" + draft.hold_id);
    if (pending && draft.quote && (!holdId || holdId === draft.hold_id)) {
      holdId = draft.hold_id;
      state.phase = "recover";
      state.quote = draft.quote;
    }
    let h;
    if (holdId) {
      try {
        if (/^\d{1,19}$/.test(holdId)) h = await api.request("/me/holds/" + holdId);
      } catch (error) {
        if (error.status !== 404) throw error;
      }
      if (!h) throw new Error(
        tx("This seat hold is unavailable for your account. Please choose seats again.", "当前账号无法使用这次占座。请重新选座。"),
      );
    }
    if (h && h.screening_id !== sid)
      throw new Error(
        tx("This seat hold belongs to a different screening. Open the hold from My tickets to continue.", "这次占座属于其他场次。请从「我的影票」打开对应的占座。"),
      );
    if (h) {
      state.hold = h;
      state.selected = new Set(h.seat_ids);
      state.target = h.seat_ids.length || (draft?.hold_id === h.id && draft.tickets?.length) || state.target;
      if (h.status === "CONVERTED") {
        state.phase = "recover";
        nextResultCheck = 0;
      } else if (state.phase !== "recover") {
        state.phase = h.effective_status === "ACTIVE" ? "held" : "expired";
      }
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
  const changeDeadline = state.source ? rescheduleDeadline(state.source.starts_at) : Infinity;
  function changeClosed() {
    return Boolean(state.source) && (Date.now() + offset > changeDeadline || state.error?.code === "RESCHEDULE_CLOSED");
  }
  function validateQuote(q) {
    if (
      q.hold_id !== state.hold?.id ||
      q.screening_id !== sid ||
      q.owner_id !== user.id ||
      (q.source_booking_id || null) !== (state.source?.id || null)
    )
      throw new Error(
        tx("This quote does not match the displayed screening and booking. Open your seat hold from My tickets.", "报价与当前场次或订单不一致。请在「我的影票」中打开你的占座。"),
      );
  }
  if (state.quote) validateQuote(state.quote);
  const canSelect = (seat) => seat.state === "AVAILABLE" || seat.held_by_me;
  if (state.phase === "choose") {
    const requested = (params.get("seat_ids") || "").split(",").filter(Boolean);
    for (const id of requested) {
      const seat = map.seats.find((v) => v.id === id);
      if (seat && canSelect(seat) && state.selected.size < state.target)
        state.selected.add(id);
    }
    if (requested.some(id => !state.selected.has(id))) {
      const taken = map.seats.filter(seat => requested.includes(seat.id) && !canSelect(seat));
      if (params.get("from") === "assistant")
        state.error = () => tx("Some selected seats are no longer available. Please review the latest map. No new seats have been held.", "部分所选座位已不可选，请按最新座位图补选，目前尚未占座。");
      else if (taken.length) state.seatConflict = taken;
      else state.error = () => tx("Please check your selection against the latest seat map.", "请按最新座位图核对已选座位。");
      saveSelectionUrl();
    }
  }
  function saveSelectionUrl() {
    if (!alive || location.hash !== pageHash) return;
    params.set("party_size", String(state.target));
    if (state.selected.size) params.set("seat_ids", [...state.selected].join(","));
    else params.delete("seat_ids");
    const next = "#/seats/" + sid + "?" + params;
    if (next !== pageHash) {
      history.replaceState(history.state, "", next);
      pageHash = location.hash;
    }
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
      if (pendingRender) requestRender();
      else tick();
    }
  }
  function keepAvailableSelection() {
    const lost = map.seats.filter(seat => state.selected.has(seat.id) && !canSelect(seat));
    if (lost.length) {
      for (const seat of lost) state.selected.delete(seat.id);
      state.seatConflict = lost;
      saveSelectionUrl();
    }
  }
  function adjacentButton() {
    if (!onSale() || state.target < 2 || (user && !customer)) return "";
    return `<button type="button" class="button secondary small" id="recommend-adjacent">${tx("Suggest adjacent seats", "一键重新推荐连座")}</button>`;
  }
  function seatConflictNotice() {
    if (!state.seatConflict || state.phase !== "choose" || !onSale()) return "";
    const needed = state.target - state.selected.size;
    const names = state.seatConflict.map(seatLabel).join(tx(", ", "、"));
    const prefix = names ? tx(`No longer available: ${names}.`, `${names} 已被占用。`)
      : tx("Some seats were just taken.", "部分座位刚被占用。");
    if (onSale() && map.seats.filter(canSelect).length >= state.target) {
      if (needed <= 0) return "";
      return notice(tx(
        `${prefix} Choose ${needed} more ${needed === 1 ? "seat" : "seats"} to continue.`,
        `${prefix} 请再选 ${needed} 个座位。`,
      ), "warning") + adjacentButton();
    }
    const search = new URLSearchParams({
      ...searchFilters,
      film_id: map.screening.film_id,
      date: map.screening.starts_at.slice(0, 10),
      party_size: String(state.target),
    });
    if (state.source) search.set("source_booking_id", state.source.id);
    return `${notice(tx(
      `${prefix} This showtime no longer has enough seats for your party.`,
      `${prefix} 本场剩余座位不足。`,
    ), "warning")}
      <p><a class="button secondary small" href="#/discover?${esc(search.toString())}">${tx("Find other showtimes", "查看其他场次")} ${icon("arrow")}</a></p>`;
  }
  function selectedSeats() {
    return map.seats.filter((seat) => state.selected.has(seat.id));
  }
  const searchFilters = showtimeFilters(params, state.source);
  const searchFare = searchFilters.fare_type === "student" ? "STUDENT" : "STANDARD";
  const fareMix = (params.get("fare_mix") || "").split(",");
  const retryFares = !state.source && fareMix.length <= 12 && fareMix.every(f => f === "STANDARD" || f === "STUDENT")
    ? fareMix : [];
  function tickets() {
    const original = state.source?.tickets || [];
    return selectedSeats().map((seat, i) => ({
      seat_id: seat.id,
      fare_type: state.fares[seat.id] || original[i]?.fare_type || retryFares[i] || searchFare,
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
    if (!state.hold) return 0;
    const expires = state.hold.expires_at;
    // MySQL stores microseconds; round the exclusive expiry up to the next browser tick.
    const subMillis = expires.match(/\.\d{3}(\d+)/)?.[1];
    return Math.max(0, Date.parse(expires) + Number(Number(subMillis) > 0) - Date.now() - offset);
  }
  function payPending() {
    return state.hold && api.pending?.("pay:" + state.hold.id);
  }
  function onSale() {
    return map.saleable &&
      new Date(map.screening.starts_at).getTime() > Date.now() + offset;
  }
  async function checkSale() {
    if (!saleCheck) {
      saleCheck = api.request("/screenings/" + sid + "/sale-status", {
        signal: AbortSignal.timeout(8000),
      }).finally(() => { saleCheck = null; });
    }
    const { saleable } = await saleCheck;
    if (!alive) return false;
    if (!saleable) {
      map.saleable = false;
      tick();
    }
    return onSale();
  }
  function refreshMap() {
    if (mapRefresh) return mapRefresh;
    const previous = map;
    const phase = state.phase;
    const hash = location.hash;
    mapRefresh = api.request("/screenings/" + sid + "/seats", { signal: AbortSignal.timeout(8000) })
      .then(next => {
        if (!alive || location.hash !== hash || state.working || state.phase !== phase || map !== previous) return;
        // A newer sale-status check may have closed the screening while this read was pending.
        if (!onSale() && next.saleable) return;
        const changed = next.saleable !== previous.saleable ||
          next.screening.revision_no !== previous.screening.revision_no ||
          next.seats.length !== previous.seats.length ||
          next.seats.some((seat, i) => {
            const old = previous.seats[i];
            return old.id !== seat.id || old.state !== seat.state || old.held_by_me !== seat.held_by_me;
          });
        map = next;
        offset = Date.parse(map.as_of) - Date.now();
        if (phase === "choose") keepAvailableSelection();
        if (changed || renderedOnSale !== onSale()) render();
      })
      .finally(() => { mapRefresh = null; });
    return mapRefresh;
  }
  function checkVisibleSale() {
    if (document.hidden || state.working || !onSale() || state.phase === "complete") return;
    if (changeClosed() && !canSyncHold()) return;
    let check;
    if (state.phase === "choose") check = refreshMap();
    else if (canSyncHold()) check = refreshHold();
    else check = checkSale();
    void check.catch(() => {}); // Keep the last known state and retry on the next poll.
  }
  function canSyncHold() {
    // A suspended tab can reach its local deadline after another tab has already paid.
    return state.hold?.status === "ACTIVE" && ["held", "quoted", "expired"].includes(state.phase);
  }
  function quotedFeeDeadline() {
    const until = state.source?.reschedule_fee_valid_through?.[state.quote?.fee_rate_bps];
    return until ? Date.parse(until) : Infinity;
  }
  function discardStaleQuote(revision) {
    if (state.phase !== "quoted" || payPending()) return false;
    if (state.quote.revision_no >= revision && Date.now() + offset <= quotedFeeDeadline()) return false;
    state.quote = null;
    state.phase = "held";
    state.error = { code: "QUOTE_CHANGED" };
    save();
    return true;
  }
  function refreshHold() {
    if (holdRefresh) return holdRefresh;
    const hold = state.hold;
    const hash = location.hash;
    holdRefresh = api.request(`/holds/${hold.id}/payment-result?include_sale_status=1`, { signal: AbortSignal.timeout(8000) })
      .then(result => {
        if (!alive || location.hash !== hash || state.hold !== hold || state.working || !canSyncHold()) return;
        if (result.saleable === false) map.saleable = false;
        if (applyTerminalResult(result) || !onSale()) return render();
        if (result.revision_no > map.screening.revision_no) {
          if (discardStaleQuote(result.revision_no)) render();
          return refreshMap();
        }
      })
      .finally(() => { holdRefresh = null; });
    return holdRefresh;
  }
  async function recommendAdjacent() {
    if (state.phase !== "choose" || !onSale()) return;
    const hash = location.hash;
    const query = new URLSearchParams({ party_size: String(state.target) });
    const zone = searchFilters.zone;
    if (zone) query.set("zone", zone);
    for (const id of state.selected) query.append("selected_id", id);
    try {
      const next = await api.request(`/screenings/${sid}/seats?${query}`, { signal: AbortSignal.timeout(8000) });
      if (!alive || location.hash !== hash || state.phase !== "choose" || !onSale()) return;
      map = next;
      offset = Date.parse(map.as_of) - Date.now();
      if (!onSale()) return render();
      keepAvailableSelection();
      const ids = next.adjacent_seat_ids;
      if (ids.length === state.target) {
        const sameSeats = ids.every(id => state.selected.has(id));
        state.selected = new Set(ids);
        saveSelectionUrl();
        state.error = null;
        state.seatConflict = null;
        const selectedZone = selectedSeats()[0].zone;
        if (zone && selectedZone !== zone) {
          toast(tx("The suggested seats are together outside your preferred zone. Review them before holding.", "这组连座在偏好区域以外，请核对位置后再占座。"));
        } else if (sameSeats && zone) {
          toast(tx("These are the only available adjacent seats for your group in your preferred zone.", "偏好区域内仅剩当前这一组符合人数的连座。"));
        } else {
          toast(sameSeats
            ? tx("Your selection is the only adjacent group available.", "当前已选座位是本场唯一可用的连座。")
            : tx("Adjacent seats selected. Confirm your selection to hold them.", "已选好连座，确认后可占座。"));
        }
      } else {
        toast(tx(`No group of ${state.target} adjacent seats is available. You can choose seats separately or try another showtime.`,
          `本场暂无 ${state.target} 个连座，可手动选择分散座位或更换场次。`), "warning");
      }
      render();
      root.querySelector("#recommend-adjacent")?.focus({ preventScroll: true });
    } catch {
      if (alive && location.hash === hash)
        toast(tx("Could not refresh seat availability. Please try again.", "暂时无法刷新座位，请重试。"), "error");
    }
  }
  function paymentSummary() {
    const q = state.quote;
    if (!q) return "";
    return `<div class="summary-line"><span>${tx("Full ticket price", "原票价")}</span><strong>${money(q.gross_ticket_minor)}</strong></div>${q.price_factor_bps === 5000 ? `<div class="summary-line"><span>${tx("50% ticket discount", "五折优惠")}</span><strong>−${money(q.gross_ticket_minor - q.net_ticket_minor)}</strong></div>` : ""}<div class="summary-line"><span>${tx("Net ticket value", "优惠后票价")}</span><strong>${money(q.net_ticket_minor)}</strong></div>${state.source ? `<div class="summary-line"><span>${tx("Previous ticket value", "原订单票款")}</span><strong>−${money(state.source.net_ticket_minor)}</strong></div><div class="summary-line"><span>${tx(`Change fee (${q.fee_rate_bps / 100}%)`, `改签费（${q.fee_rate_bps / 100}%）`)}</span><strong>${money(q.current_fee_minor)}</strong></div><div class="summary-line"><span>${tx("Fees across this booking chain", "累计改签费")}</span><strong>${money(q.cumulative_fee_minor)}</strong></div>` : ""}<div class="summary-line summary-total"><span>${q.amount_due_minor < 0 ? tx("Returned to your balance", "退回钱包") : q.amount_due_minor === 0 ? tx("No balance movement", "无需支付") : tx("Due now", "本次应付")}</span><strong>${money(Math.abs(q.amount_due_minor))}</strong></div>`;
  }
  function chosenTags() {
    const canLocate = ["choose", "held", "quoted"].includes(state.phase);
    return `<div class="summary-seats">${
      selectedSeats()
        .map(seat => {
          if (!canLocate) return `<span class="seat-tag">${seatTag(seat)}</span>`;
          const label = tx(`Show ${seatLabel(seat)} on the map`, `在座位图中定位 ${seatLabel(seat)}`);
          return `<button type="button" class="seat-tag" data-locate-seat="${esc(seat.id)}" aria-label="${esc(label)}">${icon("pin")}${seatTag(seat)}</button>`;
        })
        .join("") ||
      `<span class="muted" style="font-size:12px">${tx("No seats selected yet", "还未选座")}</span>`
    }</div>`;
  }
  function locateSeat(id) {
    const seat = root.querySelector(`[data-seat="${CSS.escape(id)}"][aria-pressed="true"]`);
    if (!seat) return;
    clearTimeout(locateTimer);
    root.querySelector(".seat-located")?.classList.remove("seat-located");
    locatedSeatId = id;
    seat.classList.add("seat-located");
    (seat.disabled ? seat.closest(".seat-scroll") : seat).focus({ preventScroll: true });
    seat.scrollIntoView({
      block: "center", inline: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    locateTimer = setTimeout(() => {
      locatedSeatId = null;
      root.querySelector(".seat-located")?.classList.remove("seat-located");
    }, 2000);
  }
  function requestRender() {
    if (!alive) return;
    if (state.working) {
      pendingRender = true;
      return;
    }
    pendingRender = false;

    render();
  }
  function render() {
    if (!alive) return;
    clearTimeout(saleTimer);
    if (state.phase === "complete") {
      renderSuccess();
      return;
    }
    const s = map.screening;
    discardStaleQuote(s.revision_no);
    renderedOnSale = onSale();
    renderedChangeClosed = changeClosed();
    if (renderedChangeClosed) {
      state.allowPaymentRetry = false;
      if (["choose", "held", "quoted", "expired"].includes(state.phase)) {
        if (payPending()) state.phase = "recover";
        else {
          root.innerHTML = closedReschedule(state.source.id);
          return;
        }
      }
    }
    if (renderedOnSale) {
      const feeBoundary = state.phase === "quoted" && !payPending() ? quotedFeeDeadline() + 1 : Infinity;
      const nextBoundary = Math.min(Date.parse(s.starts_at), renderedChangeClosed ? Infinity : changeDeadline + 1, feeBoundary);
      const untilStart = nextBoundary - Date.now() - offset;
      if (untilStart <= 2147483647) saleTimer = setTimeout(tick, untilStart);
    }
    if (!renderedOnSale && ["choose", "held", "quoted", "expired"].includes(state.phase)) {
      if (payPending()) {
        state.phase = "recover";
        state.allowPaymentRetry = false;
      } else {
        const hadSelection = state.phase === "choose" && state.selected.size > 0;
        state.selected.clear();
        if (hadSelection) saveSelectionUrl();
        state.hold = null;
        state.quote = null;
        state.phase = "choose";
      }
    }
    const isHeld = ["held", "quoted"].includes(state.phase);
    const source = state.source;
    if (isHeld && !source && couponStatus === "idle") void loadCoupons();
    const previousMap = root.querySelector(".seat-scroll");
    const mapScroll = previousMap ? { left: previousMap.scrollLeft, top: previousMap.scrollTop } : null;
    root.innerHTML = `<div class="breadcrumb"><a href="#/discover${source ? "?source_booking_id=" + esc(source.id) : ""}">${tx("Showtimes", "场次")}</a>${icon("chevron")}<span>${esc(filmTitle(film))}</span></div><div class="booking-progress"><span class="${state.phase === "choose" ? "active" : ""}"><b>1</b>${tx("Choose seats", "选座")}</span><i class="rule"></i><span class="${isHeld ? "active" : ""}"><b>2</b>${tx("Review & confirm", "核对并确认")}</span><i class="rule"></i><span><b>3</b>${tx("Your tickets", "电子影票")}</span></div><div class="page-heading"><div><p class="eyebrow">${source ? tx("RESCHEDULE YOUR WHOLE BOOKING", "整单改签") : tx("A GOOD NIGHT STARTS WITH A GOOD SEAT", "选择座位")}</p><h1>${state.phase === "recover" ? tx("Let’s confirm your booking.", "正在确认订单") : isHeld ? tx("Your seats are on hold.", "座位已为你保留") : tx("Choose your seats.", "请选择座位")}</h1></div><span class="live-note">${dateTime(s.starts_at)} · ${tx("Beijing time", "北京时间")}</span></div>${source ? notice(tx(
      `Changing ${source.tickets.length} ticket(s) from ${dateTime(source.starts_at)}. Your original booking stays valid until this change completes.`,
      `正在改签 ${dateTime(source.starts_at)} 的 ${source.tickets.length} 张票。改签完成前，原影票仍然有效。`,
    )) : ""}<div id="seat-errors">${state.error ? notice(typeof state.error === "function" ? state.error() : apiMessage(state.error.code, state.error.message), "error") : ""}${seatConflictNotice()}</div>${!onSale() ? notice(tx("This screening is no longer on sale. Please choose another showtime.", "本场次已停止售票，请选择其他场次。"), "warning") : ""}<div class="seat-layout"><section class="seat-panel"><div class="panel-header"><div><h2>${esc(venueName(cinema?.name) || tx("Cinema", "影院"))} <span class="muted" style="font-size:13px;font-weight:400">· ${esc(auditoriumName(s.screen_name) || tx("Screen", "影厅"))} · ${esc(screenName(map.screening.screen_type || "STANDARD"))}</span></h2><p class="muted" style="font-size:12px;margin:7px 0 0">${esc(venueAddress(cinema?.name, cinema?.address) || tx("Beijing", "北京"))} · ${dateTime(s.starts_at)}</p></div><button class="button ghost small" id="refresh-map" aria-label="${tx("Refresh seat availability", "刷新座位状态")}">${tx("Refresh", "刷新")}</button></div><div class="seat-legend"><span><i class="legend-box"></i>${tx("Available", "可选")}</span><span><i class="legend-box selected"></i>${tx("Your selection", "已选")}</span><span><i class="legend-box held"></i>${tx("On hold", "已占座")}</span><span><i class="legend-box sold"></i>${tx("Sold", "已售")}</span></div>${seatGrid(map, state.selected, state.phase === "choose" && onSale())}<p class="seat-help">${tx("Rows count from the screen. Clear lanes are aisles; adjacent-seat suggestions never cross them. Scroll the map sideways if needed, or use Tab and Enter.", "排号从银幕往后数，空白处是过道，连座推荐不会跨过道。可以横向滚动座位图，也可用 Tab 和 Enter 键选座。")}</p>${isHeld ? notice(tx("These seats are reserved until the countdown ends. Refreshing does not extend the hold.", "座位将保留到倒计时结束，刷新页面不会延长占座。")) : ""}</section><aside class="panel booking-summary"><div class="summary-film">${poster(film, true)}<div><h3>${esc(filmTitle(film))}</h3><p>${s.duration_minutes_snapshot ?? film.duration_minutes} ${tx("min", "分钟")} · ${esc(timeOnly(s.starts_at))}–${esc(timeOnly(s.ends_at))}</p></div></div><div class="summary-line"><span>${tx("Cinema", "影院")}</span><strong>${esc(venueName(cinema?.name) || tx("Beijing", "北京"))}</strong></div><div class="summary-line"><span>${tx("Date", "日期")}</span><strong>${dateTime(s.starts_at, { hour: undefined, minute: undefined })}</strong></div>${state.phase === "choose" ? `<label class="field" style="margin-top:16px"><span>${tx("Number of tickets", "购票人数")}</span><select id="party-size" ${source ? "disabled" : ""}>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === state.target ? "selected" : ""}>${tx(`${i + 1} ${i === 0 ? "ticket" : "tickets"}`, `${i + 1} 张`)}</option>`).join("")}</select></label>` : ""}${chosenTags()}${isHeld ? `<div class="hold-clock">${icon("clock")}<span>${tx("Seats held for", "剩余占座时间")}</span><strong id="countdown">—</strong></div>` : ""}<div id="checkout-controls">${controls()}</div></aside></div>`;
    if (mapScroll) {
      const currentMap = root.querySelector(".seat-scroll");
      currentMap.scrollLeft = mapScroll.left;
      currentMap.scrollTop = mapScroll.top;
    }
    if (locatedSeatId && state.selected.has(locatedSeatId))
      root.querySelector(`[data-seat="${CSS.escape(locatedSeatId)}"]`)?.classList.add("seat-located");
    root.querySelectorAll("[data-locate-seat]").forEach(button => {
      button.onclick = () => locateSeat(button.dataset.locateSeat);
    });
    root.querySelectorAll("[data-seat]").forEach(
      (button) =>
        (button.onclick = async () => {
          if (!onSale()) return render();
          const id = button.dataset.seat;
          if (!state.selected.has(id)) {
            try {
              if (!(await checkSale())) return;
            } catch {
              if (alive) toast(tx("Could not verify ticket availability. Please try again.", "暂时无法确认售票状态，请重试。"), "error");
              return;
            }
            if (state.working || state.phase !== "choose" ||
                !root.querySelector(`[data-seat="${id}"]:enabled`)) return;
          }
          if (state.selected.has(id)) state.selected.delete(id);
          else if (state.selected.size < state.target) state.selected.add(id);
          else {
            toast(
              tx(`Choose up to ${state.target} seats, or change the ticket count.`, `最多可选 ${state.target} 座，也可以修改购票人数。`),
              "error",
            );
            return;
          }
          state.error = null;
          if (state.selected.size === state.target) state.seatConflict = null;
          saveSelectionUrl();
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
      saveSelectionUrl();
      render();
    });
    root.querySelector("#recommend-adjacent")?.addEventListener("click", (e) =>
      busy(e.currentTarget, () => lockWhile(recommendAdjacent), tx("Finding seats…", "正在查找连座…")),
    );
    root.querySelector("#refresh-map").onclick = (e) =>
      busy(
        e.currentTarget,
        async () => {
          try {
            if (canSyncHold()) {
              await refreshHold();
              if (!alive || !["held", "quoted"].includes(state.phase)) return;
            }
            await refreshMap();
          } catch (err) {
            if (alive && root.querySelector("#seat-errors")) showError(root.querySelector("#seat-errors"), err);
          }
        },
        tx("Refreshing…", "正在刷新…"),
      );
    root
      .querySelector("#create-hold")
      ?.addEventListener("click", (e) =>
        busy(e.currentTarget, () => lockWhile(createHold), tx("Holding seats…", "正在占座…")),
      );
    root.querySelector("#quote-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      busy(
        form.querySelector("[type=submit]"),
        () => lockWhile(requestQuote),
        tx("Getting price…", "正在计算价格…"),
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
    root.querySelector("#retry-coupons")?.addEventListener("click", () => {
      void loadCoupons();
      render();
    });
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
          tx("Confirming…", "正在确认…"),
        ),
      );
    root.querySelector("#check-result")?.addEventListener("click", () =>
      lockWhile(checkPaymentResult),
    );
    root
      .querySelector("#change-seats")
      ?.addEventListener("click", (e) =>
        busy(e.currentTarget, () => lockWhile(release), tx("Releasing…", "正在释放…")),
      );
    root.querySelector("#reselect")?.addEventListener("click", () => {
      const next = new URLSearchParams({ ...searchFilters, party_size: String(state.target) });
      if (source) {
        next.set("source_booking_id", source.id);
      } else {
        // Expiry cleanup can remove the seat allocations before this page is reopened.
        const savedTickets = draft?.hold_id === state.hold.id ? draft.tickets : [];
        const previous = state.selected.size ? tickets() : savedTickets;
        const fares = previous?.length ? previous.map(ticket => ticket.fare_type) : retryFares;
        if (fares.some(fare => fare !== searchFare)) next.set("fare_mix", fares.join(","));
      }
      sessionStorage.removeItem(draftKey);
      navigate("#/seats/" + sid + "?" + next);
    });
    tick();
  }
  function payLabel() {
    const amount = state.quote.amount_due_minor;
    if (amount < 0) return tx(`Confirm change & refund ${money(-amount)}`, `确认改签并退回 ${money(-amount)}`);
    if (!amount) return tx("Confirm change — no payment", "确认改签，无需支付");
    return state.source
      ? tx(`Pay ${money(amount)} & change`, `支付 ${money(amount)} 并改签`)
      : tx(`Pay ${money(amount)} & book`, `支付 ${money(amount)} 并购票`);
  }
  async function loadCoupons() {
    couponStatus = "loading";
    try {
      const rows = await allRows(api, "/me/coupons", AbortSignal.timeout(8000));
      coupons = rows.filter(c => c.cinema_id === map.screening.cinema_id && c.status === "AVAILABLE");
      couponStatus = "ready";
    } catch {
      couponStatus = "error";
    }
    if (state.phase === "held" || state.phase === "quoted") requestRender();
  }
  function couponField() {
    const id = state.coupon_id;
    const savedOption = id && !coupons.some(c => c.id === id)
      ? `<option selected value="${esc(id)}">${tx("Previously selected coupon", "此前选择的优惠券")} · ${esc(id.slice(-6))}</option>` : "";
    const options = coupons.map(c => `<option value="${esc(c.id)}" ${id === c.id ? "selected" : ""}>${tx("50% off · coupon", "五折券 · 编号")} ${esc(c.id.slice(-6))}</option>`);
    const hint = couponStatus === "loading" ? tx("Loading coupons…", "正在加载优惠券…")
      : couponStatus === "error" ? tx("Coupons could not be loaded. You can retry or review the price with your current selection.", "优惠券暂时无法加载。可重试，也可按当前选择核价。")
      : tx("Only unused coupons from this cinema apply.", "仅可使用本影院的未使用优惠券。");
    return `<label class="field" style="margin:18px 0"><span>${tx("Coupon", "优惠券")}</span>
      <select id="coupon"><option value="">${tx("No coupon", "不使用优惠券")}</option>${savedOption}${options.join("")}</select>
      <small role="status">${hint}</small></label>${couponStatus === "error" ? `<button id="retry-coupons" type="button" class="button secondary small">${tx("Retry coupons", "重新加载优惠券")}</button>` : ""}`;
  }
  function controls() {
    if (state.phase === "recover")
      return `${notice(state.allowPaymentRetry ? tx("No receipt yet. We’ll keep checking. You can also retry the same payment while the hold is active.", "暂未收到回执，系统会继续查询。占座有效期间，你也可以重试同一笔付款。") : tx("Checking your payment. You can find confirmed tickets in your account.", "正在查询付款结果，已确认的影票可在「我的影票」查看。"), "warning")}${paymentSummary()}<button class="button wide" id="check-result">${tx("Check payment result", "查询付款结果")}</button>${state.allowPaymentRetry && onSale() && remaining() > 0 ? `<button class="button ghost wide" id="pay-now">${tx("Retry the same payment", "重试同一笔付款")}</button>` : ""}<a class="button ghost wide" href="#/account">${tx("View my tickets", "查看我的影票")}</a>`;
    if (state.phase === "expired")
      return `${notice(state.hold?.status === "CANCELLED"
        ? tx("This hold has been released. Check My holds for your current reservation.", "本次占座已释放，可在「我的占座」查看当前保留的座位。")
        : tx("This seat hold has ended. Your earlier confirmed tickets, if any, remain unchanged.", "本次占座已结束。此前已确认的影票仍按原订单状态处理。"), "warning")}<button class="button wide" id="reselect">${tx("Choose seats again", "重新选座")}</button>${state.hold?.status === "CANCELLED" ? `<a class="button ghost wide" href="#/account?tab=holds">${tx("View my holds", "查看我的占座")}</a>` : ""}`;
    if (state.phase === "choose") {
      const selected = state.selected.size;
      const ticketTotal = tickets().reduce(
        (sum, t) =>
          sum +
          (map.fares.find((f) => f.fare_type === t.fare_type)?.price_minor ||
            0),
        0,
      );
      const recommend = state.seatConflict && selected < state.target ? "" : adjacentButton();
      return `${recommend}<div class="summary-line"><span>${tx("Selected", "已选")}</span><strong>${tx(`${selected} / ${state.target} seats`, `${selected} / ${state.target} 座`)}</strong></div><div class="summary-line summary-total"><span>${tx("Face price estimate", "预计票款")}</span><strong>${money(ticketTotal)}</strong></div><p class="fine-print">${tx("Choose ticket types and an eligible coupon at the next step. Any change fee is quoted before confirmation.", "下一步可以选择票种及可用优惠券。改签费会在确认前列明。")}</p>${!onSale() ? `<button class="button wide" id="create-hold" disabled>${tx("Booking closed", "已停止售票")}</button>` : !user ? `<a class="button wide" href="#/login?next=${encodeURIComponent("#/seats/" + sid + "?" + new URLSearchParams({ ...searchFilters, party_size: String(state.target), seat_ids: [...state.selected].join(","), ...(state.source ? { source_booking_id: state.source.id } : {}), ...(params.get("from") === "assistant" ? { from: "assistant" } : {}) }))}">${tx("Sign in to hold seats", "登录并占座")} ${icon("arrow")}</a>` : !customer ? `<p class="notice">${tx("Customer accounts book here. For assisted sales, open the cinema workspace.", "顾客可在此购票，员工请进入影院工作台办理柜台售票。")}</p><a class="button wide" href="${counterSalesUrl}">${tx("Open counter sales", "进入柜台售票")}</a>` : `<button class="button wide" id="create-hold" ${selected !== state.target ? "disabled" : ""}>${tx(`Hold ${selected || "your"} ${selected === 1 ? "seat" : "seats"}`, selected ? `保留 ${selected} 个座位` : "保留座位")} ${icon("arrow")}</button>`}<p class="fine-print">${tx("A hold lasts up to 5 minutes. Browsing and selecting do not reserve a seat.", "座位最多保留 5 分钟。点击占座后才会保留座位。")}</p>`;
    }
    return `<form id="quote-form"><div class="fare-choices">${tickets()
      .map((t) => {
        const seat = map.seats.find((st) => st.id === t.seat_id);
        return `<div class="fare-line"><label for="fare-${t.seat_id}">${seatTag(seat)}</label><select id="fare-${t.seat_id}" data-fare="${t.seat_id}" aria-label="${esc(tx(`Ticket type for ${seatLabel(seat)}`, `${seatLabel(seat)}的票种`))}" ${state.source ? "disabled" : ""}>${map.fares.map((f) => `<option value="${f.fare_type}" ${t.fare_type === f.fare_type ? "selected" : ""}>${fareLabel(f.fare_type)} · ${money(f.price_minor)}</option>`).join("")}</select></div>`;
      })
      .join(
        "",
      )}</div>${state.source ? `<p class="fine-print">${tx("Your original ticket mix and discount are carried forward.", "改签沿用原票种和折扣。")}</p>` : couponField()}<p class="fine-print">${tx("Student eligibility is checked at admission.", "入场时需出示有效学生证明。")}</p>${state.phase === "quoted" ? `${paymentSummary()}<button class="button wide" type="button" id="pay-now">${payLabel()}${icon("arrow")}</button><p class="fine-print">${state.source ? tx("Only a successful change releases your old tickets.", "改签成功后才会释放原座位。") : tx("Payment uses your demo wallet balance.", "本次使用演示钱包余额付款。")} ${tx("The server verifies the current price and seat hold again.", "确认时会再次核对票价和占座状态。")}</p>` : `<button class="button wide" type="submit">${tx("Review final price", "核对最终价格")} ${icon("arrow")}</button>`}</form><button class="button ghost wide small" id="change-seats" style="margin-top:12px">${tx("Release hold & change seats", "释放占座并重新选座")}</button>`;
  }
  function tick() {
    if (!alive || state.phase === "complete") return;
    if (renderedChangeClosed !== changeClosed()) return render();
    if (renderedOnSale && !onSale() && (!state.working || state.phase === "choose"))
      return render();
    if (!state.hold) return;
    if (!state.working && discardStaleQuote(map.screening.revision_no)) return render();
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
    if (state.phase === "recover" && state.allowPaymentRetry && ms <= 0) {
      state.allowPaymentRetry = false;
      render();
    }
    if (!state.working && state.phase === "recover" && Date.now() >= nextResultCheck)
      void lockWhile(checkPaymentResult);
  }
  async function createHold() {
    if (!onSale() || changeClosed()) return render();
    const initialHash = location.hash;
    try {
      state.error = null;
      const h = await api.action("hold:" + sid, "/holds", {
        screening_id: sid,
        seat_ids: [...state.selected],
        source_booking_id: state.source?.id || null,
      });
      if (!alive || location.hash !== initialHash) return;
      if (!onSale()) return render();
      state.hold = { ...h, id: h.hold_id };
      state.phase = "held";
      state.seatConflict = null;
      state.quote = null;
      save();
      params.set("hold_id", h.hold_id);
      saveSelectionUrl();
      map = await api.request("/screenings/" + sid + "/seats");
      if (!alive) return;
      render();
      if (state.phase === "held") toast(tx("Your seats are on hold. Review ticket types and price.", "座位已保留，请核对票种和价格。"));
    } catch (e) {
      if (!alive) return;
      state.error = e;
      if (e.code === "SALE_CLOSED") map.saleable = false;
      if (e.code === "SEAT_UNAVAILABLE") {
        try {
          map = await api.request("/screenings/" + sid + "/seats");
          if (!alive) return;
          offset = new Date(map.as_of).getTime() - Date.now();
          keepAvailableSelection();
          state.seatConflict ??= [];
          state.error = null;
        } catch {
          // Until the map refreshes, the original error remains visible.
        }
      }
      render();
    }
  }
  async function requestQuote() {
    if (changeClosed()) return render();
    try {
      state.error = null;
      const q = await api.request("/holds/" + state.hold.id + "/quote", {
        method: "POST",
        body: {
          tickets: tickets(),
          coupon_id: state.source ? null : state.coupon_id,
        },
      });
      if (!alive) return;
      validateQuote(q);
      if (q.revision_no > map.screening.revision_no) {
        // The manager may have updated fares between the last poll and this quote.
        const next = await api.request("/screenings/" + sid + "/seats", { signal: AbortSignal.timeout(8000) });
        if (!alive) return;
        map = next;
        offset = Date.parse(next.as_of) - Date.now();
      }
      state.quote = q;
      state.phase = "quoted";
      save();
      render();
    } catch (e) {
      state.error = e;
      if (e.code === "SALE_CLOSED") map.saleable = false;
      if (e.code === "HOLD_EXPIRED") {
        state.phase = "expired";
        return checkPaymentResult();
      }
      if (e.code === "TOKEN_EXPIRED")
        state.phase = "expired";
      render();
    }
  }
  async function release() {
    const holdId = state.hold.id;
    let expectedHash = location.hash;
    try {
      const result = await api.request("/holds/" + holdId, { method: "DELETE" });
      if (result.status === "CONVERTED") {
        if (!alive || location.hash !== expectedHash) return;
        state.hold.status = "CONVERTED";
        state.phase = "recover";
        return checkPaymentResult();
      }
      if (readDraft(draftKey)?.hold_id === holdId) sessionStorage.removeItem(draftKey);
      if (!alive || location.hash !== expectedHash) return;
      state.hold = null;
      state.quote = null;
      state.phase = "choose";
      state.error = null;
      params.delete("hold_id");
      if (state.source) params.set("source_booking_id", state.source.id);
      else params.delete("source_booking_id");
      saveSelectionUrl();
      expectedHash = location.hash;
      const nextMap = await api.request("/screenings/" + sid + "/seats");
      if (!alive || location.hash !== expectedHash) return;
      map = nextMap;
      keepAvailableSelection();
      render();
    } catch (e) {
      if (!alive || location.hash !== expectedHash) return;
      state.error = e;
      render();
    }
  }
  function applyTerminalResult(result) {
    if (!["CONFIRMED", "EXPIRED", "CANCELLED"].includes(result.status)) return false;
    api.clearPending("pay:" + state.hold.id);
    state.quote = null;
    state.error = null;
    if (result.status === "CONFIRMED") {
      if (readDraft(draftKey)?.hold_id === state.hold.id) sessionStorage.removeItem(draftKey);
      state.selected = new Set(result.seat_ids);
      state.receipt = result.receipt;
      state.phase = "complete";
    } else {
      state.hold.status = result.status;
      state.phase = "expired";
    }
    return true;
  }
  async function checkPaymentResult() {
    try {
      const result = await api.request(`/holds/${state.hold.id}/payment-result`, {
        signal: AbortSignal.timeout(12000),
      });
      if (!alive) return;
      state.error = null;
      if (result.status === "ACTIVE") {
        state.allowPaymentRetry = Boolean(state.quote) && state.hold.status !== "CONVERTED";
      } else applyTerminalResult(result);
    } catch (e) {
      state.error = e;
      state.allowPaymentRetry = false;
    } finally {
      nextResultCheck = Date.now() + checkDelay;
      checkDelay = Math.min(15000, checkDelay * 2);
      render();
    }
  }
  async function pay() {
    if (changeClosed() || discardStaleQuote(map.screening.revision_no)) return render();
    if (!state.quote) return;
    save();
    try {
      state.error = null;
      state.receipt = await api.action("pay:" + state.hold.id, "/bookings", {
        quote_token: state.quote.quote_token,
      }, { signal: AbortSignal.timeout(12000) });
      state.phase = "complete";
      sessionStorage.removeItem(draftKey);
      render();
      toast(
        state.source
          ? tx("Your booking has been changed.", "改签成功。")
          : tx("Your tickets are confirmed.", "出票成功。"),
      );
    } catch (e) {
      state.error = e;
      if (e.code === "SALE_CLOSED") map.saleable = false;
      if (api.pending("pay:" + state.hold.id)) {
        state.phase = "recover";
        state.allowPaymentRetry = false;
        checkDelay = 2000;
        nextResultCheck = Date.now() + checkDelay;
      } else if (e.code === "HOLD_EXPIRED") {
        state.phase = "expired";
        return checkPaymentResult();
      } else if (e.code === "TOKEN_EXPIRED")
        state.phase = "expired";
      else if (e.code === "QUOTE_CHANGED") {
        state.phase = "held";
        state.quote = null;
        save();
      } else state.phase = "quoted";
      render();
    }
  }
  function renderSuccess() {
    const s = map.screening;
    const r = state.receipt;
    if (r.status && r.status !== "CONFIRMED") {
      root.innerHTML = `<section class="panel"><h1>${tx("These tickets are no longer valid", "影票已失效")}</h1><p>${tx("This booking has been cancelled or rescheduled. Check your account for the current tickets and any refund.", "此订单已取消或改签。请在「我的影票」查看有效影票及退款。")}</p><a class="button" href="#/account?tab=orders&booking=${esc(r.booking_id)}">${tx("View booking and refund", "查看订单和退款")}</a></section>`;
      return;
    }
    root.innerHTML = `<section class="panel success-panel"><div class="success-mark">${icon("check")}</div><p class="eyebrow">${state.source ? tx("NEW PLANS, CONFIRMED", "改签成功") : tx("YOU’RE GOING TO THE MOVIES", "购票成功")}</p><h1>${state.source ? tx("Your booking is changed.", "改签已确认") : tx("See you at the cinema.", "出票成功")}</h1><p class="muted">${state.source ? tx("Your old seats have been released and your new tickets are ready.", "原座位已释放，新影票已生成。") : tx("Your tickets are confirmed. Find the details in your account anytime.", "影票已确认，可随时在「我的影票」查看。")}</p><div class="success-ticket"><span class="badge">${tx("Confirmed", "已出票")}</span><h2 style="margin-top:15px">${esc(filmTitle(film))}</h2><p class="muted" style="font-size:13px">${esc(venueName(cinema?.name) || tx("Cinema", "影院"))} · ${esc(auditoriumName(s.screen_name) || tx("Screen", "影厅"))} · ${dateTime(s.starts_at)}</p>${chosenTags()}<div class="summary-line"><span>${r.amount_due_minor < 0 ? tx("Returned to balance", "已退回钱包") : tx("Paid from balance", "钱包已扣款")}</span><strong>${money(Math.abs(r.amount_due_minor))}</strong></div><div class="summary-line"><span>${tx("Remaining balance", "钱包余额")}</span><strong>${money(r.balance_minor)}</strong></div><p class="fine-print" style="margin-bottom:0">${tx("Booking", "订单")} ${esc(r.booking_id)}</p></div><div class="actions">${customer ? `<button type="button" class="button" data-success-ticket>${icon("ticket")} ${tx("View ticket", "查看电子票")}</button>` : ""}<a class="button ${customer ? "secondary" : ""}" href="#/account?tab=orders&booking=${esc(r.booking_id)}">${tx("View my tickets", "查看我的影票")} ${icon("arrow")}</a><a class="button ghost" href="#/discover">${tx("Back to showtimes", "返回场次列表")}</a></div></section>`;
    const ticket = root.querySelector("[data-success-ticket]");
    if (ticket) {
      ticket.onclick = () => {
        closeTicket?.();
        closeTicket = openTicketCard(api, r.booking_id, ticket);
      };
    }
  }
  ctx.updateLanguage = requestRender;
  render();
  interval = setInterval(tick, 1000);
  const salePoll = setInterval(checkVisibleSale, 5000);
  document.addEventListener("visibilitychange", tick);
  document.addEventListener("visibilitychange", checkVisibleSale);
  return () => {
    alive = false;
    closeTicket?.();
    clearInterval(salePoll);
    clearTimeout(locateTimer);
    document.removeEventListener("visibilitychange", checkVisibleSale);
    document.removeEventListener("visibilitychange", tick);
    clearTimeout(saleTimer);
    clearInterval(interval);
  };
}

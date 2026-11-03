import { esc, money, dateTime, empty, notice } from "./ui.js";

const PAGE_SIZE = 8;
const TABS = [
  ["orders", "My tickets"],
  ["holds", "On hold"],
  ["wallet", "Wallet history"],
  ["coupons", "Coupons"],
  ["refunds", "Refunds"],
  ["notices", "Notices"],
];
const STATUS = {
  CONFIRMED: "Confirmed",
  RESCHEDULED: "Rescheduled",
  CINEMA_CANCELLED: "Cinema cancelled",
  ACTIVE: "Awaiting payment",
  CONVERTED: "Purchased",
  EXPIRED: "Expired",
  CANCELLED: "Released",
  AVAILABLE: "Available",
  USED: "Used",
  PENDING: "Refund pending",
  FAILED: "Awaiting cinema retry",
  SUCCEEDED: "Returned to wallet",
};
const FARES = { STANDARD: "Standard", STUDENT: "Student" };
const CASH_LABELS = {
  INITIAL_CREDIT: "Welcome demo credit",
  PAYMENT: "Ticket / rescheduling payment",
  REFUND: "Refund received",
};
const TYPES = {
  STANDARD: "Standard",
  IMAX: "IMAX",
  DOLBY_CINEMA: "Dolby Cinema",
};
const isPositive = (v) => Number(v) > 0;
const asList = (value) => (Array.isArray(value) ? value : value?.items || []);
const shortId = (id) => String(id || "").slice(-8);

function badge(value) {
  const tone = ["CONFIRMED", "AVAILABLE", "SUCCEEDED"].includes(value)
    ? "success"
    : ["ACTIVE", "PENDING", "FAILED"].includes(value)
      ? "warning"
      : "";
  return `<span class="badge ${tone}">${esc(STATUS[value] || value || "Unknown status")}</span>`;
}

function accountURL(tab, params = {}) {
  const query = new URLSearchParams({ tab, ...params });
  return `#/account?${query}`;
}

function pagination(data, tab, extra = {}) {
  const total = Number(data.total || 0);
  const page = Number(data.page || 1);
  const size = Number(data.page_size || PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(total / size));
  if (!total) return "";
  return `<nav class="toolbar" aria-label="Record pagination">
    <span class="muted">${total} ${total === 1 ? "record" : "records"} · Page ${page} of ${pages}</span>
    <div class="actions">
      ${page > 1 ? `<a class="button secondary" href="${accountURL(tab, { ...extra, page: page - 1 })}">Previous</a>` : ""}
      ${page < pages ? `<a class="button secondary" href="${accountURL(tab, { ...extra, page: page + 1 })}">Next</a>` : ""}
    </div>
  </nav>`;
}

function datum(label, value) {
  return `<div><span class="muted">${esc(label)}</span><p>${value}</p></div>`;
}

function refundSummary(refunds = []) {
  if (!refunds.length)
    return '<span class="muted">No refunds for this order</span>';
  return refunds
    .map(
      (r) => `<p>${badge(r.status)} <strong>${money(r.amount_minor)}</strong>
    <span class="muted">${r.reason === "CINEMA_CANCELLATION" ? "Cinema cancellation" : "Rescheduling difference"}</span></p>`,
    )
    .join("");
}

function bookingDetails(b) {
  const coupon = b.compensation_coupon;
  return `<div class="stack">
    <div class="form-grid">
      ${datum("Full ticket value", money(b.gross_ticket_minor))}
      ${datum("Net ticket value", money(b.net_ticket_minor))}
      ${datum("This change fee", money(b.current_fee_minor))}
      ${datum("Total fees across this booking chain", money(b.cumulative_fee_minor))}
    </div>
    <p class="account-table-hint">Swipe across the table to see all prices.</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="Ticket seats and face prices"><table class="table">
      <caption class="muted">Seats and original face prices</caption>
      <thead><tr><th scope="col">Seat</th><th scope="col">Fare type</th><th scope="col">Face price at issue</th></tr></thead>
      <tbody>${(b.tickets || []).map((t) => `<tr><td>${esc(`Row ${t.row_no} · Seat ${t.seat_no}`)}</td><td>${esc(FARES[t.fare_type] || t.fare_type)}</td><td>${money(t.face_price_minor)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted">${Number(b.price_factor_bps) === 5000 ? "The 50% ticket discount carries forward through future changes without using another coupon." : "No coupon was applied to this booking chain."} Student eligibility is checked on admission.</p>
    <div class="split">
      <div><h4>Refunds</h4>${refundSummary(b.refunds)}</div>
      <div><h4>Compensation coupon</h4>${coupon ? `${badge(coupon.status)}<p class="muted">50% off at this cinema · No expiry</p>` : '<p class="muted">No compensation coupon issued</p>'}</div>
    </div>
    ${coupon || (b.refunds || []).length ? notice("Refunds and coupons are processed separately. An issued coupon does not confirm a refund; check wallet history for the actual credit.") : ""}
    <p class="muted">Booked ${esc(dateTime(b.created_at))} · ${b.channel === "COUNTER" ? "Counter purchase" : "Online purchase"}${Number(b.change_no) ? ` · Change ${Number(b.change_no)}` : ""}</p>
    <p class="muted">Booking ID: <span style="overflow-wrap:anywhere">${esc(b.id)}</span></p>
    ${b.predecessor_id ? `<p><a href="${accountURL("orders", { booking: b.predecessor_id })}">View preceding booking →</a></p>` : ""}
  </div>`;
}

/** Personal centre. All monetary amounts and transactional states come from the API. */
export async function renderAccount(ctx) {
  const { root, api, user, bootstrap, toast } = ctx;
  const lifecycle = new AbortController();
  let alive = true;
  let timer = null;
  let dialog = null;
  let version = 0;
  function cleanup() {
    alive = false;
    version += 1;
    lifecycle.abort();
    clearInterval(timer);
    dialog?.remove();
  }
  // Cancel this view immediately when navigation starts, even while its initial
  // read is pending and the router has not received our cleanup callback yet.
  window.addEventListener("hashchange", cleanup, {
    once: true,
    signal: lifecycle.signal,
  });
  const query = new URLSearchParams(location.hash.split("?")[1] || "");
  const requestedTab = query.get("tab") || "orders";
  const tab = TABS.some(([id]) => id === requestedTab)
    ? requestedTab
    : "orders";
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(query.get("page"), 10) || 1),
  );
  const status = ["CONFIRMED", "HISTORY"].includes(query.get("status"))
    ? query.get("status")
    : "";
  const selectedBooking = query.get("booking");
  const getCinema = (id) =>
    asList(bootstrap?.cinemas).find((c) => String(c.id) === String(id))?.name ||
    "Cinema";
  const getFilm = (id) =>
    asList(bootstrap?.films).find((f) => String(f.id) === String(id))?.title ||
    "Film";

  if (!user || user.role !== "CUSTOMER") {
    root.innerHTML = `<div class="account-page"><div class="page-heading"><div><p class="eyebrow">YOUR CINEMA</p><h1>My account</h1></div></div>${empty("Your next cinema visit, all in one place", "Sign in to manage your tickets, wallet, coupons and refunds.")}<a class="button" href="#/login">Customer sign in</a></div>`;
    return cleanup;
  }

  function shell() {
    root.innerHTML = `<div class="account-page"><div class="page-heading">
      <div><p class="eyebrow">YOUR CINEMA</p><h1>Your cinema journal</h1><p class="muted">${esc(user.display_name)}, your next screening and every booking along the way.</p></div>
      <a class="button secondary" href="#/discover">Find your next film <span aria-hidden="true">↗</span></a>
    </div>
    <section class="panel account-wallet" aria-label="My wallet"><div class="toolbar">
      <div><span class="muted">Available demo balance</span><h2 id="account-balance" aria-live="polite">Loading…</h2></div>
      <p class="muted">¥1,000 welcome credit on first registration<br>Simulated funds only · No real top-ups</p>
    </div></section>
    <nav class="tabs" aria-label="Account sections">${TABS.map(([id, title]) => `<a class="tab ${tab === id ? "active" : ""}" ${tab === id ? 'aria-current="page"' : ""} href="${accountURL(id)}">${title}</a>`).join("")}</nav>
    <section id="account-content" class="stack" aria-live="polite"><div class="panel"><p class="muted">Loading ${esc(TABS.find(([id]) => id === tab)[1].toLowerCase())}…</p></div></section></div>`;
  }

  function bookCard(b) {
    const start = b.starts_at ? Date.parse(b.starts_at) : NaN;
    const mayChange =
      b.status === "CONFIRMED" &&
      Number.isFinite(start) &&
      start - Date.now() >= 30 * 60 * 1000;
    const ended =
      b.status === "CONFIRMED" && Number.isFinite(start) && start <= Date.now();
    const open = String(selectedBooking || "") === String(b.id);
    const partySize = Number(b.ticket_count ?? b.tickets?.length ?? 0);
    return `<article class="panel" data-booking="${esc(b.id)}">
      <div class="panel-header"><div><p class="eyebrow">${esc(b.cinema_name || getCinema(b.cinema_id))}</p><h2>${esc(b.film_title || getFilm(b.film_id))}</h2></div><div class="actions">${badge(b.status)}${ended ? '<span class="badge">Started</span>' : ""}</div></div>
      <div class="form-grid account-booking-facts">
        ${datum("Beijing time", esc(b.starts_at ? dateTime(b.starts_at) : "See booking details"))}
        ${datum("Screen", esc([b.screen_name, TYPES[b.screen_type]].filter(Boolean).join(" · ") || "Cinema screen"))}
        ${datum("Party size", `${partySize} ${partySize === 1 ? "person" : "people"}`)}
        ${datum("Net ticket value", `<strong>${money(b.net_ticket_minor)}</strong>`)}
      </div>
      <div class="toolbar"><span class="muted">Booking · ${esc(shortId(b.id))}${Number(b.change_no) ? ` · ${Number(b.change_no)} ${Number(b.change_no) === 1 ? "change" : "changes"}` : ""}</span>
        ${mayChange ? `<a class="button secondary" href="#/discover?source_booking_id=${encodeURIComponent(b.id)}">Reschedule party</a>` : b.status === "CONFIRMED" ? '<span class="muted">Changes close 30 minutes before the screening</span>' : ""}
      </div>
      <details ${open ? "open" : ""} data-order-details="${esc(b.id)}"><summary class="button ghost">Seats, fees & compensation</summary><div class="stack" data-detail-content="${esc(b.id)}">${b.tickets ? bookingDetails(b) : '<p class="muted">Open to load full booking details.</p>'}</div></details>
    </article>`;
  }

  function ordersMarkup(data, focus) {
    const filters = [
      ["", "All bookings"],
      ["CONFIRMED", "Confirmed"],
      ["HISTORY", "History & cancellations"],
    ];
    return `<div class="toolbar"><div class="actions" aria-label="Filter booking status">${filters.map(([value, title]) => `<a class="button ${status === value ? "" : "secondary"}" ${status === value ? 'aria-current="true"' : ""} href="${accountURL("orders", value ? { status: value } : {})}">${title}</a>`).join("")}</div><button type="button" class="button ghost" data-action="refresh">Refresh</button></div>
      ${notice("Change the whole party to the same film and cinema, keeping the fare mix. Fees: 0% at least 12 hours ahead; 5% from 6 to under 12 hours; 20% from 30 minutes to under 6 hours. Changes close 30 minutes before the current screening.")}
      ${focus && !data.items.some((b) => String(b.id) === String(focus.id)) ? `<section aria-label="Selected booking">${bookCard(focus)}</section>` : ""}
      ${data.items.length ? data.items.map((b) => bookCard(focus && String(focus.id) === String(b.id) ? focus : b)).join("") : empty("No tickets here yet", status ? "No bookings in this category. Try All bookings." : "Find a film you love and save a place for your next cinema visit.")}
      ${pagination(data, "orders", status ? { status } : {})}`;
  }

  function holdsMarkup(data) {
    return `${notice("Seats are held for up to five minutes; refreshing does not extend the timer. Expired or released seats become available again. Purchased tickets are unaffected.")}
      ${
        data.items.length
          ? data.items
              .map((h) => {
                const active =
                  h.effective_status === "ACTIVE" &&
                  Date.parse(h.expires_at) > Date.now();
                return `<article class="panel" data-hold="${esc(h.id)}" ${active ? `data-expires="${esc(h.expires_at)}"` : ""}>
          <div class="panel-header"><div><p class="eyebrow">${esc(getCinema(h.cinema_id))}</p><h2>${esc(getFilm(h.film_id))}</h2></div><span data-hold-state>${badge(active ? "ACTIVE" : h.effective_status === "ACTIVE" ? "EXPIRED" : h.effective_status)}</span></div>
          <p>${active ? `${h.seat_ids?.length || 0} seats · ` : ""}${h.source_booking_id ? "Rescheduling hold · Original tickets stay valid until the change succeeds" : "New booking hold"}</p>
          <p class="muted">Created ${esc(dateTime(h.created_at))} · Expires ${esc(dateTime(h.expires_at))}</p>
          ${active ? `<div class="toolbar"><strong data-countdown></strong><div class="actions"><button type="button" class="button ghost danger" data-action="cancel-hold" data-id="${esc(h.id)}">Release hold</button><a class="button" data-resume href="#/seats/${encodeURIComponent(h.screening_id)}?hold_id=${encodeURIComponent(h.id)}">Continue to payment →</a></div></div>` : ""}
        </article>`;
              })
              .join("")
          : empty(
              "No seats on hold",
              "When you hold seats, return here to finish your booking.",
            )
      }
      ${pagination(data, "holds")}`;
  }

  function walletMarkup(data) {
    return `<div class="panel"><div class="panel-header"><div><p class="eyebrow">EVERY TRANSACTION</p><h2>Wallet history</h2></div><button type="button" class="button ghost" data-action="refresh">Refresh</button></div>
      <p class="muted">Positive amounts are credits; negative amounts are payments. Each immutable entry shows the balance immediately after that transaction.</p>
      ${data.items.length ? `<p class="account-table-hint">Swipe across the table to see amounts and balances.</p><div class="table-wrap" tabindex="0" role="region" aria-label="Wallet transactions"><table class="table"><thead><tr><th scope="col">Transaction</th><th scope="col">Beijing time</th><th scope="col">Amount</th><th scope="col">Balance after</th></tr></thead><tbody>${data.items.map((e) => `<tr><td><strong>${esc(CASH_LABELS[e.entry_type] || "Balance change")}</strong><p class="muted">Entry · ${esc(shortId(e.id))}</p></td><td>${esc(dateTime(e.created_at))}</td><td><strong${isPositive(e.amount_minor) ? ' class="success-text"' : ""}>${isPositive(e.amount_minor) ? "+" : ""}${money(e.amount_minor)}</strong></td><td>${money(e.balance_after_minor)}</td></tr>`).join("")}</tbody></table></div>` : empty("No wallet history yet", "Completed payments and refunds will appear here.")}
      </div>${pagination(data, "wallet")}`;
  }

  function couponsMarkup(data) {
    return `${notice("Each coupon takes 50% off the ticket total of one new booking at its issuing cinema. Any film, party size, date or screen type; no expiry. One coupon per booking. Rescheduling inherits the discount and cannot add another coupon.")}
      ${data.items.length ? `<div class="form-grid">${data.items.map((c) => `<article class="panel"><div class="panel-header"><div><p class="eyebrow">${esc(getCinema(c.cinema_id))}</p><h2>50% off your tickets</h2></div>${badge(c.status)}</div><p class="muted">Cinema cancellation compensation · No expiry</p><p>Issued ${esc(dateTime(c.issued_at))}</p><div class="actions"><a class="button ghost" href="${accountURL("orders", { booking: c.source_booking_id })}">Source booking</a>${c.status === "AVAILABLE" ? `<a class="button secondary" href="#/discover?cinema_id=${encodeURIComponent(c.cinema_id)}">Explore this cinema</a>` : c.redeemed_booking_id ? `<a class="button secondary" href="${accountURL("orders", { booking: c.redeemed_booking_id })}">View redeemed booking</a>` : ""}</div></article>`).join("")}</div>` : empty("No coupons yet", "If a cinema cancels a purchased screening, each affected active booking receives one 50% coupon for that cinema.")}
      ${pagination(data, "coupons")}`;
  }

  function refundsMarkup(data) {
    return `<div class="toolbar"><p class="muted">Refunds and coupons have separate states. Successful refunds are credited to your demo wallet.</p><button type="button" class="button ghost" data-action="refresh">Refresh status</button></div>
      ${data.items.length ? data.items.map((r) => `<article class="panel"><div class="panel-header"><div><p class="eyebrow">${esc(getCinema(r.cinema_id))}</p><h2>${money(r.amount_minor)}</h2></div>${badge(r.status)}</div><p>${r.reason === "CINEMA_CANCELLATION" ? "Cinema cancellation: current net tickets plus all accumulated fees in this booking chain." : "Rescheduling difference: the credit after settling new tickets and the current change fee."}</p><p class="muted">Requested ${esc(dateTime(r.created_at))}${r.settled_at ? ` · Received ${esc(dateTime(r.settled_at))}` : ""}</p>${r.status === "FAILED" ? notice("This refund has not reached your wallet. The cinema needs to retry it; keep your booking reference and check the status again later.", "warning") : ""}<a class="button secondary" href="${accountURL("orders", { booking: r.booking_id })}">View booking</a></article>`).join("") : empty("No refunds yet", "Track refunds here when rescheduling produces a credit or your cinema cancels a screening.")}
      ${pagination(data, "refunds")}`;
  }

  function noticesMarkup(data) {
    return `${data.items.length ? data.items.map((n) => `<article class="panel" data-notice="${esc(n.id)}"><div class="panel-header"><div><p class="eyebrow">${esc(getCinema(n.cinema_id))}</p><h2>Cinema notice</h2></div><span data-notice-state class="badge ${n.read_at ? "" : "warning"}">${n.read_at ? "Read" : "Unread"}</span></div><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(n.body)}</p><p class="muted">${esc(dateTime(n.created_at))}</p><div class="actions"><a class="button secondary" href="${accountURL("orders", { booking: n.booking_id })}">View booking & compensation</a>${!n.read_at ? `<button class="button ghost" type="button" data-action="read-notice" data-id="${esc(n.id)}">Mark as read</button>` : ""}</div></article>`).join("") : empty("No notices yet", "Screening changes and cinema compensation notices will appear here.")}
      ${pagination(data, "notices")}`;
  }

  function tick() {
    if (!alive) return;
    root.querySelectorAll("[data-expires]").forEach((card) => {
      const remain = Math.max(
        0,
        Math.ceil((Date.parse(card.dataset.expires) - Date.now()) / 1000),
      );
      const clock = card.querySelector("[data-countdown]");
      if (clock)
        clock.textContent = remain
          ? `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")} remaining`
          : "Hold expired. Choose seats again.";
      if (!remain) {
        card.querySelector("[data-hold-state]").innerHTML = badge("EXPIRED");
        const resume = card.querySelector("[data-resume]");
        if (resume) {
          resume.removeAttribute("href");
          resume.setAttribute("aria-disabled", "true");
          resume.textContent = "Hold expired";
        }
        const cancel = card.querySelector('[data-action="cancel-hold"]');
        if (cancel) cancel.disabled = true;
        delete card.dataset.expires;
      }
    });
  }

  async function load() {
    if (!alive) return;
    const generation = ++version;
    shell();
    const content = root.querySelector("#account-content");
    const resource = {
      wallet: "wallet-entries",
      orders: "bookings",
      holds: "holds",
      coupons: "coupons",
      refunds: "refunds",
      notices: "notices",
    }[tab];
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    if (tab === "orders" && status) params.set("status", status);
    const path = tab === "orders" ? "/ui/bookings" : `/me/${resource}`;
    const results = await Promise.allSettled([
      api.request("/me/wallet", { signal: lifecycle.signal }),
      api.request(`${path}?${params}`, { signal: lifecycle.signal }),
      tab === "orders" && selectedBooking
        ? api.request(`/ui/bookings/${encodeURIComponent(selectedBooking)}`, {
            signal: lifecycle.signal,
          })
        : Promise.resolve(null),
    ]);
    if (!alive || generation !== version || !root.contains(content)) return;
    const [wallet, result, focus] = results;
    root.querySelector("#account-balance").textContent =
      wallet.status === "fulfilled"
        ? money(wallet.value.balance_minor)
        : "Unavailable";
    if (result.status === "rejected") {
      content.innerHTML = `${notice(result.reason?.userMessage || result.reason?.message || "Unable to load your records. Please try again.", "error")}<button type="button" class="button secondary" data-action="refresh">Try again</button>`;
      return;
    }
    const renderers = {
      orders: (d) =>
        ordersMarkup(d, focus.status === "fulfilled" ? focus.value : null),
      holds: holdsMarkup,
      wallet: walletMarkup,
      coupons: couponsMarkup,
      refunds: refundsMarkup,
      notices: noticesMarkup,
    };
    content.innerHTML = `${focus.status === "rejected" ? notice(focus.reason?.userMessage || focus.reason?.message || "Unable to load this booking.", "error") : ""}${renderers[tab](result.value)}`;
    if (wallet.status === "rejected")
      content.insertAdjacentHTML(
        "afterbegin",
        notice(
          "Your balance could not be loaded. Refresh to try again.",
          "warning",
        ),
      );
    tick();
  }

  function confirmRelease(id, opener) {
    dialog?.remove();
    dialog = document.createElement("dialog");
    dialog.className = "panel account-dialog";
    dialog.setAttribute("aria-labelledby", "release-title");
    dialog.innerHTML = `<h2 id="release-title">Release these seats?</h2><p>These seats will be available to other customers. If this is a rescheduling hold, your original tickets remain valid.</p><div data-release-error></div><div class="actions"><button type="button" class="button secondary" data-keep>Keep my seats</button><button type="button" class="button danger" data-confirm-release>Release seats</button></div>`;
    root.append(dialog);
    dialog
      .querySelector("[data-keep]")
      .addEventListener("click", () => dialog.close());
    dialog.addEventListener(
      "close",
      () => {
        dialog?.remove();
        dialog = null;
        opener?.focus();
      },
      { once: true },
    );
    dialog
      .querySelector("[data-confirm-release]")
      .addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Releasing…";
        try {
          await api.request(`/holds/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (!alive) return;
          dialog?.close();
          toast("Seat hold released");
          await load();
        } catch (error) {
          if (!alive || !dialog) return;
          dialog.querySelector("[data-release-error]").innerHTML = notice(
            error.userMessage ||
              error.message ||
              "Unable to release this hold. Please try again.",
            "error",
          );
          button.disabled = false;
          button.textContent = "Retry release";
        }
      });
    dialog.showModal();
    dialog.querySelector("[data-keep]").focus();
  }

  root.addEventListener(
    "click",
    async (event) => {
      const button = event.target.closest("[data-action]");
      if (!button || !root.contains(button) || button.disabled) return;
      if (button.dataset.action === "refresh") {
        button.disabled = true;
        await load();
        return;
      }
      if (button.dataset.action === "cancel-hold") {
        confirmRelease(button.dataset.id, button);
        return;
      }
      if (button.dataset.action === "read-notice") {
        button.disabled = true;
        try {
          await api.request(
            `/notices/${encodeURIComponent(button.dataset.id)}/read`,
            { method: "PUT", body: {} },
          );
          if (!alive) return;
          const state = button
            .closest("[data-notice]")
            .querySelector("[data-notice-state]");
          state.textContent = "Read";
          state.className = "badge";
          button.remove();
          toast("Notice marked as read");
        } catch (error) {
          if (alive) {
            button.disabled = false;
            toast(
              error.userMessage ||
                error.message ||
                "Unable to mark this notice as read. Please try again.",
              "error",
            );
          }
        }
      }
    },
    { signal: lifecycle.signal },
  );

  // The toggle event does not bubble, so capture it on the persistent route root.
  root.addEventListener(
    "toggle",
    async (event) => {
      const details = event.target;
      if (
        !(details instanceof HTMLDetailsElement) ||
        !details.dataset.orderDetails ||
        !details.open ||
        details.dataset.loaded ||
        details.dataset.loading
      )
        return;
      const holder = details.querySelector("[data-detail-content]");
      if (!holder || holder.querySelector("table")) {
        details.dataset.loaded = "true";
        return;
      }
      details.dataset.loading = "true";
      holder.innerHTML = '<p class="muted">Loading full booking details…</p>';
      try {
        const detail = await api.request(
          `/ui/bookings/${encodeURIComponent(details.dataset.orderDetails)}`,
          { signal: lifecycle.signal },
        );
        if (!alive || !details.isConnected) return;
        holder.innerHTML = bookingDetails(detail);
        details.dataset.loaded = "true";
      } catch (error) {
        if (alive && details.isConnected)
          holder.innerHTML = notice(
            `${error.userMessage || error.message || "Unable to load booking details."} Close and reopen this section to try again.`,
            "error",
          );
      } finally {
        delete details.dataset.loading;
      }
    },
    { capture: true, signal: lifecycle.signal },
  );

  await load();
  if (alive) timer = setInterval(tick, 1000);
  return cleanup;
}

import { venueName, auditoriumName } from "./venue-locale.js";
import { esc, money, dateTime, empty, notice, screenName } from "./ui.js";
import { openTicketCard } from "./ticket-card.js";
import { tx } from "./locale.js";
import { filmTitle } from "./film-locale.js";

const PAGE_SIZE = 8;
const TABS = [
  ["orders", "My tickets", "我的影票"],
  ["holds", "On hold", "待付款"],
  ["wallet", "Wallet history", "钱包明细"],
  ["coupons", "Coupons", "优惠券"],
  ["refunds", "Refunds", "退款"],
  ["notices", "Notices", "通知"],
];
const STATUS = {
  CONFIRMED: ["Confirmed", "已出票"],
  RESCHEDULED: ["Rescheduled", "已改签"],
  CINEMA_CANCELLED: ["Cinema cancelled", "影院已取消"],
  CUSTOMER_CANCELLED: ["Refunded · tickets cancelled", "已退款 · 影票已取消"],
  ACTIVE: ["Awaiting payment", "待付款"],
  CONVERTED: ["Purchased", "已购票"],
  EXPIRED: ["Expired", "已过期"],
  CANCELLED: ["Released", "已释放"],
  AVAILABLE: ["Available", "可使用"],
  USED: ["Used", "已使用"],
  PENDING: ["Refund pending", "退款处理中"],
  FAILED: ["Awaiting cinema retry", "等待影院重试"],
  SUCCEEDED: ["Returned to wallet", "已退回钱包"],
};
const FARES = { STANDARD: ["Standard", "标准票"], STUDENT: ["Student", "学生票"] };
const CASH_LABELS = {
  INITIAL_CREDIT: ["Welcome demo credit", "注册赠送的演示余额"],
  PAYMENT: ["Ticket / rescheduling payment", "购票或改签付款"],
  REFUND: ["Refund received", "退款到账"],
};
const isPositive = (v) => Number(v) > 0;
const asList = (value) => (Array.isArray(value) ? value : value?.items || []);
const shortId = (id) => String(id || "").slice(-8);
const seatLabel = (seat) => tx(
  `Row ${seat.row_no} · Seat ${seat.seat_no}`,
  `${seat.row_no} 排 ${seat.seat_no} 座`,
);

// Historic notices include staff-authored reasons. Translate only the two system templates.
function noticeBody(body) {
  const cancelled = /^Screening cancelled: (.*)\. Refund pending; a same-cinema 50% coupon is available\. No automatic rebooking\.$/s.exec(body);
  if (cancelled) return tx(body, `场次已取消。原因：${cancelled[1]}。退款待处理，本店五折券已发放。如需继续观影，请重新订票。`);
  const refund = /^Your tickets have been cancelled and all seats released\. Refund: ¥([\d.]+) to your demo wallet\. Cancellation fee: ¥([\d.]+)\. These tickets are no longer valid\.$/.exec(body);
  if (refund) return tx(body, `退票已完成，座位已释放。¥${refund[1]} 已退回演示钱包，退票手续费为 ¥${refund[2]}。原影票已失效。`);
  return body;
}

function badge(value) {
  const tone = ["CONFIRMED", "AVAILABLE", "SUCCEEDED"].includes(value)
    ? "success"
    : ["ACTIVE", "PENDING", "FAILED"].includes(value)
      ? "warning"
      : "";
  const label = STATUS[value] ? tx(...STATUS[value]) : value || tx("Unknown status", "未知状态");
  return `<span class="badge ${tone}">${esc(label)}</span>`;
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
  return `<nav class="toolbar" aria-label="${tx("Record pagination", "记录分页")}">
    <span class="muted">${tx(`${total} ${total === 1 ? "record" : "records"} · Page ${page} of ${pages}`, `共 ${total} 条 · 第 ${page} / ${pages} 页`)}</span>
    <div class="actions">
      ${page > 1 ? `<a class="button secondary" href="${accountURL(tab, { ...extra, page: page - 1 })}">${tx("Previous", "上一页")}</a>` : ""}
      ${page < pages ? `<a class="button secondary" href="${accountURL(tab, { ...extra, page: page + 1 })}">${tx("Next", "下一页")}</a>` : ""}
    </div>
  </nav>`;
}

function datum(label, value) {
  return `<div><span class="muted">${esc(label)}</span><p>${value}</p></div>`;
}

function refundSummary(refunds = []) {
  if (!refunds.length)
    return `<span class="muted">${tx("No refunds for this order", "该订单暂无退款")}</span>`;
  return refunds
    .map(
      (r) => `<p>${badge(r.status)} <strong>${money(r.amount_minor)}</strong>
    <span class="muted">${r.reason === "CUSTOMER_CANCELLATION" ? tx("Your ticket refund", "退票退款") : r.reason === "CINEMA_CANCELLATION" ? tx("Cinema cancellation", "影院取消") : tx("Rescheduling difference", "改签差额")}</span></p>`,
    )
    .join("");
}

function bookingActionDisabledReason(booking, current = Date.now()) {
  if (booking.status === "CUSTOMER_CANCELLED")
    return tx("This booking has already been refunded.", "该订单已退款。");
  if (booking.status === "CINEMA_CANCELLED")
    return tx("Cancelled by the cinema. Check Refunds for your refund status.", "影院已取消场次。请在退款页查看进度。");
  if (booking.status === "RESCHEDULED")
    return tx("This booking was rescheduled. Open your new booking to request a refund.", "该订单已改签。请在新订单中申请退票。");
  if (booking.status !== "CONFIRMED")
    return tx("This booking is not eligible for a refund.", "该订单不符合退票条件。");
  const start = Date.parse(booking.starts_at);
  const end = Date.parse(booking.ends_at);
  if (!Number.isFinite(start))
    return tx("Screening time is unavailable. Refresh to check rescheduling and refunds.", "暂时无法获取放映时间，请刷新后查看是否可以改签或退票。");
  if (Number.isFinite(end) && end <= current)
    return tx("This screening has ended. Rescheduling and refunds are closed.", "场次已结束，无法改签或退票。");
  if (start <= current)
    return tx("This screening has already started. Rescheduling and refunds are closed.", "场次已开始，无法改签或退票。");
  if (start - current < 30 * 60 * 1000)
    return tx("Less than 30 minutes to showtime. Rescheduling and refunds are closed.", "距开场不足 30 分钟，无法改签或退票。");
  return "";
}

function bookingDetails(b) {
  const coupon = b.compensation_coupon;
  const cancellation = b.cancellation;
  return `<div class="stack">
    ${cancellation ? `<section class="account-refund-receipt" aria-label="${tx("Ticket refund receipt", "退票凭证")}">
      <h3>${tx("Tickets cancelled · seats released", "影票已取消 · 座位已释放")}</h3>
      <p>${tx("These tickets can no longer be used for admission.", "这些影票已不能用于入场。")}</p>
      <div class="form-grid">
        ${datum(tx("Returned to demo wallet", "已退回演示钱包"), `<strong>${money(cancellation.refund_minor)}</strong>`)}
        ${datum(tx("Cancellation fee", "退票手续费"), money(cancellation.fee_minor))}
      </div>
      <p class="muted">${tx("Completed", "完成时间")} ${esc(dateTime(cancellation.created_at))} · ${tx("Previous change fees are not refunded.", "此前的改签手续费不退。")}</p>
    </section>` : ""}
    <div class="form-grid">
      ${datum(tx("Full ticket value", "票面总价"), money(b.gross_ticket_minor))}
      ${datum(tx("Net ticket value", "折后票款"), money(b.net_ticket_minor))}
      ${datum(tx("This change fee", "本次改签手续费"), money(b.current_fee_minor))}
      ${datum(tx("Total fees across this booking chain", "累计改签手续费"), money(b.cumulative_fee_minor))}
    </div>
    <p class="account-table-hint">${tx("Swipe across the table to see all prices.", "横向滑动表格可查看全部票价。")}</p>
    <div class="table-wrap" tabindex="0" role="region" aria-label="${tx("Ticket seats and face prices", "座位和票面价格")}"><table class="table">
      <caption class="muted">${tx("Seats and original face prices", "座位和原始票面价格")}</caption>
      <thead><tr><th scope="col">${tx("Seat", "座位")}</th><th scope="col">${tx("Fare type", "票种")}</th><th scope="col">${tx("Face price at issue", "出票时票面价格")}</th></tr></thead>
      <tbody>${(b.tickets || []).map((t) => `<tr><td>${esc(seatLabel(t))}</td><td>${esc(FARES[t.fare_type] ? tx(...FARES[t.fare_type]) : t.fare_type)}</td><td>${money(t.face_price_minor)}</td></tr>`).join("")}</tbody>
    </table></div>
    <p class="muted">${Number(b.price_factor_bps) === 5000
      ? tx("The 50% ticket discount carries forward through future changes without using another coupon.", "后续改签可保留五折优惠，无需再用优惠券。")
      : tx("No coupon was applied to this booking chain.", "该订单及其改签未使用优惠券。")} ${tx("Student eligibility is checked on admission.", "入场时将查验学生票资格。")}</p>
    <div class="split">
      <div><h4>${tx("Refunds", "退款")}</h4>${refundSummary(b.refunds)}</div>
      <div><h4>${tx("Compensation coupon", "补偿券")}</h4>${coupon
        ? `${badge(coupon.status)}<p class="muted">${tx("50% off at this cinema · No expiry", "本影院五折 · 长期有效")}</p>`
        : `<p class="muted">${tx("No compensation coupon issued", "未发放补偿券")}</p>`}</div>
    </div>
    ${coupon || (b.refunds || []).length ? notice(tx(
      "Refunds and coupons are processed separately. An issued coupon does not confirm a refund; check wallet history for the actual credit.",
      "退款和优惠券分别处理。退款是否到账，请查看钱包明细。",
    )) : ""}
    <p class="muted">${tx("Booked", "下单时间")} ${esc(dateTime(b.created_at))} · ${b.channel === "COUNTER" ? tx("Counter purchase", "柜台购票") : tx("Online purchase", "线上购票")}${Number(b.change_no) ? tx(` · Change ${Number(b.change_no)}`, ` · 第 ${Number(b.change_no)} 次改签`) : ""}</p>
    <p class="muted">${tx("Booking ID:", "订单号")} <span style="overflow-wrap:anywhere">${esc(b.id)}</span></p>
    ${b.predecessor_id ? `<p><a href="${accountURL("orders", { booking: b.predecessor_id })}">${tx("View preceding booking →", "查看改签前的订单 →")}</a></p>` : ""}
  </div>`;
}

/** Personal centre. All monetary amounts and transactional states come from the API. */
export async function renderAccount(ctx) {
  const { root, api, user, bootstrap, toast } = ctx;
  const lifecycle = new AbortController();
  let alive = true;
  let timer = null;
  let dialog = null;
  let closeTicket = null;
  let version = 0;
  function cleanup() {
    alive = false;
    version += 1;
    lifecycle.abort();
    clearInterval(timer);
    dialog?.remove();
    closeTicket?.();
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
    venueName(asList(bootstrap?.cinemas).find((c) => String(c.id) === String(id))?.name) ||
    tx("Cinema", "影院");
  const getFilm = (id, title) =>
    filmTitle(title || asList(bootstrap?.films).find((f) => String(f.id) === String(id))) ||
    tx("Film", "影片");

  if (!user || user.role !== "CUSTOMER") {
    root.innerHTML = `<div class="account-page"><div class="page-heading"><div><p class="eyebrow">${tx("YOUR CINEMA", "个人中心")}</p><h1>${tx("My account", "我的账户")}</h1></div></div>${empty(tx("Your next cinema visit, all in one place", "查看我的观影安排"), tx("Sign in to manage your tickets, wallet, coupons and refunds.", "登录后可管理影票、钱包、优惠券和退款。"))}<a class="button" href="#/login">${tx("Customer sign in", "顾客登录")}</a></div>`;
    return cleanup;
  }

  function shell() {
    const [, tabEn, tabZh] = TABS.find(([id]) => id === tab);
    root.innerHTML = `<div class="account-page"><div class="page-heading">
      <div><p class="eyebrow">${tx("YOUR CINEMA", "个人中心")}</p><h1>${tx("Your cinema journal", "我的观影记录")}</h1><p class="muted">${tx(`${esc(user.display_name)}, your next screening and every booking along the way.`, `${esc(user.display_name)}，在这里查看你的场次与订单。`)}</p></div>
      <a class="button secondary" href="#/discover">${tx("Find your next film", "查找场次")} <span aria-hidden="true">↗</span></a>
    </div>
    <section class="panel account-wallet" aria-label="${tx("My wallet", "我的钱包")}"><div class="toolbar">
      <div><span class="muted">${tx("Available demo balance", "演示钱包可用余额")}</span><h2 id="account-balance" aria-live="polite">${tx("Loading…", "加载中…")}</h2></div>
      <p class="muted">${tx("¥1,000 welcome credit on first registration", "首次注册赠送 ¥1,000 演示余额")}<br>${tx("Simulated funds only · No real top-ups", "仅用于模拟支付")}</p>
    </div></section>
    <nav class="tabs" aria-label="${tx("Account sections", "个人中心导航")}">${TABS.map(([id, en, zh]) => `<a class="tab ${tab === id ? "active" : ""}" ${tab === id ? 'aria-current="page"' : ""} href="${accountURL(id)}">${tx(en, zh)}</a>`).join("")}</nav>
    <section id="account-content" class="stack" aria-live="polite"><div class="panel"><p class="muted">${tx(`Loading ${tabEn.toLowerCase()}…`, `正在加载${tabZh}…`)}</p></div></section></div>`;
  }

  function bookCard(b) {
    const start = b.starts_at ? Date.parse(b.starts_at) : NaN;
    const ended =
      b.status === "CONFIRMED" && Number.isFinite(start) && start <= Date.now();
    const reason = bookingActionDisabledReason(b);
    const open = String(selectedBooking || "") === String(b.id);
    const partySize = Number(b.ticket_count ?? b.tickets?.length ?? 0);
    return `<article class="panel" data-booking="${esc(b.id)}">
      <div class="panel-header"><div><p class="eyebrow">${esc(venueName(b.cinema_name) || getCinema(b.cinema_id))}</p><h2>${esc(getFilm(b.film_id, b.film_title))}</h2></div><div class="actions">${badge(b.status)}${ended ? `<span class="badge">${tx("Started", "已开场")}</span>` : ""}</div></div>
      <div class="form-grid account-booking-facts">
        ${datum(tx("Beijing time", "北京时间"), esc(b.starts_at ? dateTime(b.starts_at) : tx("See booking details", "请查看订单详情")))}
        ${datum(tx("Screen", "影厅"), esc([auditoriumName(b.screen_name), screenName(b.screen_type)].filter(Boolean).join(" · ") || tx("Cinema screen", "影厅")))}
        ${datum(tx("Party size", "人数"), tx(`${partySize} ${partySize === 1 ? "person" : "people"}`, `${partySize} 人`))}
        ${datum(tx("Net ticket value", "折后票款"), `<strong>${money(b.net_ticket_minor)}</strong>`)}
      </div>
      <div class="toolbar"><span class="muted">${tx("Booking", "订单")} · ${esc(shortId(b.id))}${Number(b.change_no) ? tx(` · ${Number(b.change_no)} ${Number(b.change_no) === 1 ? "change" : "changes"}`, ` · 已改签 ${Number(b.change_no)} 次`) : ""}</span>
        <div class="account-refund-actions"><div class="actions">
          <button type="button" class="button" data-action="view-ticket" data-id="${esc(b.id)}">${tx("View ticket", "查看电子票")}</button>
          ${reason ? "" : `<a class="button secondary" data-reschedule href="#/discover?source_booking_id=${encodeURIComponent(b.id)}">${tx("Reschedule party", "整单改签")}</a>`}
          <button type="button" class="button secondary" data-action="refund-booking" data-id="${esc(b.id)}" data-booking-status="${esc(b.status)}" data-starts-at="${esc(b.starts_at || "")}" data-ends-at="${esc(b.ends_at || "")}" aria-describedby="refund-reason-${esc(b.id)}" ${reason ? "disabled" : ""}>${tx("Refund tickets", "退票")}</button>
        </div><p id="refund-reason-${esc(b.id)}" class="muted account-refund-reason" data-refund-reason aria-live="polite" ${reason ? "" : "hidden"}>${esc(reason)}</p></div>
      </div>
      <details ${open ? "open" : ""} data-order-details="${esc(b.id)}"><summary class="button ghost">${tx("Seats, fees & compensation", "座位、费用与补偿")}</summary><div class="stack" data-detail-content="${esc(b.id)}">${b.tickets ? bookingDetails(b) : `<p class="muted">${tx("Open to load full booking details.", "展开查看完整订单详情。")}</p>`}</div></details>
    </article>`;
  }

  function ordersMarkup(data, focus) {
    const filters = [
      ["", tx("All bookings", "全部订单")],
      ["CONFIRMED", tx("Confirmed", "已出票")],
      ["HISTORY", tx("History & cancellations", "历史与取消")],
    ];
    return `<div class="toolbar"><div class="actions" aria-label="${tx("Filter booking status", "按订单状态筛选")}">${filters.map(([value, title]) => `<a class="button ${status === value ? "" : "secondary"}" ${status === value ? 'aria-current="true"' : ""} href="${accountURL("orders", value ? { status: value } : {})}">${title}</a>`).join("")}</div><button type="button" class="button ghost" data-action="refresh">${tx("Refresh", "刷新")}</button></div>
      ${notice(tx(
        "Change the whole party to the same film and cinema, keeping the fare mix. Fees: 0% at least 12 hours ahead; 5% from 6 to under 12 hours; 20% from 30 minutes to under 6 hours. The same fee bands apply to whole-booking refunds. Changes and refunds close 30 minutes before the current screening. Refunds return the net ticket value minus the cancellation fee to your demo wallet; previous change fees are not refunded.",
        "可为同一订单的所有观众改签同一影院、同一影片的场次，票种不变。退票与改签的手续费相同：距开场至少 12 小时免费，6 至不足 12 小时收取 5%，30 分钟至不足 6 小时收取 20%。开场前 30 分钟截止。折后票款扣除退票手续费后退回演示钱包，此前的改签手续费不退。",
      ))}
      ${focus && !data.items.some((b) => String(b.id) === String(focus.id)) ? `<section aria-label="${tx("Selected booking", "选中的订单")}">${bookCard(focus)}</section>` : ""}
      ${data.items.length ? data.items.map((b) => bookCard(focus && String(focus.id) === String(b.id) ? focus : b)).join("") : empty(
        tx("No tickets here yet", "暂无影票"),
        status ? tx("No bookings in this category. Try All bookings.", "该分类暂无订单，可查看全部订单。") : tx("Find a film you love and save a place for your next cinema visit.", "浏览影片和场次，选一个喜欢的座位。"),
      )}
      ${pagination(data, "orders", status ? { status } : {})}`;
  }

  function holdsMarkup(data) {
    return `${notice(tx(
      "Seats are held for up to five minutes; refreshing does not extend the timer. Expired or released seats become available again. Purchased tickets are unaffected.",
      "座位最多保留 5 分钟，刷新不会延长时间。到期或释放后，其他观众可重新选择这些座位。已购买的影票不受影响。",
    ))}
      ${
        data.items.length
          ? data.items
              .map((h) => {
                const active =
                  h.effective_status === "ACTIVE" &&
                  Date.parse(h.expires_at) > Date.now();
                return `<article class="panel" data-hold="${esc(h.id)}" ${active ? `data-expires="${esc(h.expires_at)}"` : ""}>
          <div class="panel-header"><div><p class="eyebrow">${esc(getCinema(h.cinema_id))}</p><h2>${esc(getFilm(h.film_id))}</h2></div><span data-hold-state>${badge(active ? "ACTIVE" : h.effective_status === "ACTIVE" ? "EXPIRED" : h.effective_status)}</span></div>
          <p>${active ? tx(`${h.seat_ids?.length || 0} seats · `, `${h.seat_ids?.length || 0} 个座位 · `) : ""}${h.source_booking_id ? tx("Rescheduling hold · Original tickets stay valid until the change succeeds", "改签占座 · 改签成功前原影票仍有效") : tx("New booking hold", "新订单占座")}</p>
          <p class="muted">${tx("Created", "占座时间")} ${esc(dateTime(h.created_at))} · ${tx("Expires", "到期时间")} ${esc(dateTime(h.expires_at))}</p>
          ${active ? `<div class="toolbar"><strong data-countdown></strong><div class="actions"><button type="button" class="button ghost danger" data-action="cancel-hold" data-id="${esc(h.id)}">${tx("Release hold", "释放座位")}</button><a class="button" data-resume href="#/seats/${encodeURIComponent(h.screening_id)}?hold_id=${encodeURIComponent(h.id)}">${tx("Continue to payment →", "继续付款 →")}</a></div></div>` : ""}
        </article>`;
              })
              .join("")
          : empty(
              tx("No seats on hold", "暂无待付款座位"),
              tx("When you hold seats, return here to finish your booking.", "占座后可在这里继续付款。"),
            )
      }
      ${pagination(data, "holds")}`;
  }

  function walletMarkup(data) {
    return `<div class="panel">
      <div class="panel-header"><div><p class="eyebrow">${tx("EVERY TRANSACTION", "交易记录")}</p><h2>${tx("Wallet history", "钱包明细")}</h2></div><button type="button" class="button ghost" data-action="refresh">${tx("Refresh", "刷新")}</button></div>
      <p class="muted">${tx(
        "Positive amounts are credits; negative amounts are payments. Each immutable entry shows the balance immediately after that transaction.",
        "正数为入账，负数为付款。每条记录显示交易完成时的余额。",
      )}</p>
      ${data.items.length ? `
        <p class="account-table-hint">${tx("Swipe across the table to see amounts and balances.", "横向滑动表格可查看金额和余额。")}</p>
        <div class="table-wrap" tabindex="0" role="region" aria-label="${tx("Wallet transactions", "钱包交易")}"><table class="table">
          <thead><tr>
            <th scope="col">${tx("Transaction", "交易")}</th><th scope="col">${tx("Beijing time", "北京时间")}</th>
            <th scope="col">${tx("Amount", "金额")}</th><th scope="col">${tx("Balance after", "交易后余额")}</th>
          </tr></thead>
          <tbody>${data.items.map((e) => `<tr>
            <td><strong>${esc(CASH_LABELS[e.entry_type] ? tx(...CASH_LABELS[e.entry_type]) : tx("Balance change", "余额变动"))}</strong><p class="muted">${tx("Entry", "流水")} · ${esc(shortId(e.id))}</p></td>
            <td>${esc(dateTime(e.created_at))}</td>
            <td><strong${isPositive(e.amount_minor) ? ' class="success-text"' : ""}>${isPositive(e.amount_minor) ? "+" : ""}${money(e.amount_minor)}</strong></td>
            <td>${money(e.balance_after_minor)}</td>
          </tr>`).join("")}</tbody>
        </table></div>` : empty(tx("No wallet history yet", "暂无钱包明细"), tx("Completed payments and refunds will appear here.", "已完成的付款和退款会显示在这里。"))}
    </div>${pagination(data, "wallet")}`;
  }

  function couponsMarkup(data) {
    return `${notice(tx(
      "Each coupon takes 50% off the ticket total of one new booking at its issuing cinema. Any film, party size, date or screen type; no expiry. One coupon per booking. Rescheduling inherits the discount and cannot add another coupon.",
      "每张优惠券可在发券影院的新订单中享受票款五折，不限影片、人数、日期和厅型，长期有效。每单限用一张。改签保留原优惠，不能叠加新券。",
    ))}
      ${data.items.length ? `<div class="form-grid">${data.items.map((c) => `<article class="panel">
        <div class="panel-header"><div><p class="eyebrow">${esc(getCinema(c.cinema_id))}</p><h2>${tx("50% off your tickets", "五折购票券")}</h2></div>${badge(c.status)}</div>
        <p class="muted">${tx("Cinema cancellation compensation · No expiry", "影院取消场次补偿 · 长期有效")}</p>
        <p>${tx("Issued", "发放时间")} ${esc(dateTime(c.issued_at))}</p>
        <div class="actions">
          <a class="button ghost" href="${accountURL("orders", { booking: c.source_booking_id })}">${tx("Source booking", "来源订单")}</a>
          ${c.status === "AVAILABLE"
            ? `<a class="button secondary" href="#/discover?cinema_id=${encodeURIComponent(c.cinema_id)}">${tx("Explore this cinema", "查看该影院场次")}</a>`
            : c.redeemed_booking_id ? `<a class="button secondary" href="${accountURL("orders", { booking: c.redeemed_booking_id })}">${tx("View redeemed booking", "查看用券订单")}</a>` : ""}
        </div>
      </article>`).join("")}</div>` : empty(
        tx("No coupons yet", "暂无优惠券"),
        tx("If a cinema cancels a purchased screening, each affected active booking receives one 50% coupon for that cinema.", "影院取消场次时，每笔受影响的有效订单会收到该影院的一张五折券。"),
      )}
      ${pagination(data, "coupons")}`;
  }

  function refundsMarkup(data) {
    return `<div class="toolbar">
      <p class="muted">${tx("Refunds and coupons have separate states. Successful refunds are credited to your demo wallet.", "退款和优惠券分别处理。退款成功后会退回演示钱包。")}</p>
      <button type="button" class="button ghost" data-action="refresh">${tx("Refresh status", "刷新状态")}</button>
    </div>
      ${data.items.length ? data.items.map((r) => `<article class="panel">
        <div class="panel-header"><div><p class="eyebrow">${esc(getCinema(r.cinema_id))}</p><h2>${money(r.amount_minor)}</h2></div>${badge(r.status)}</div>
        <p>${r.reason === "CUSTOMER_CANCELLATION"
          ? tx("Your ticket refund: net ticket value minus the cancellation fee. All seats have been released and these tickets are no longer valid.", "退票退款为折后票款扣除退票手续费。座位已释放，原票已失效。")
          : r.reason === "CINEMA_CANCELLATION"
            ? tx("Cinema cancellation: current net tickets plus all accumulated fees in this booking chain.", "影院取消场次后，退还当前折后票款和累计改签手续费。")
            : tx("Rescheduling difference: the credit after settling new tickets and the current change fee.", "改签差额为结算新票和本次改签手续费后应退回的金额。")}</p>
        <p class="muted">${tx("Requested", "申请时间")} ${esc(dateTime(r.created_at))}${r.settled_at ? ` · ${tx("Received", "到账时间")} ${esc(dateTime(r.settled_at))}` : ""}</p>
        ${r.status === "FAILED" ? notice(tx(
          "This refund has not reached your wallet. The cinema needs to retry it; keep your booking reference and check the status again later.",
          "该笔退款还未到账，需要影院重试。请保留订单号，稍后查看退款进度。",
        ), "warning") : ""}
        <a class="button secondary" href="${accountURL("orders", { booking: r.booking_id })}">${tx("View booking", "查看订单")}</a>
      </article>`).join("") : empty(
        tx("No refunds yet", "暂无退款"),
        tx("Track your ticket refunds, rescheduling credits and cinema cancellations here.", "在这里查看退票、改签差额和影院取消场次产生的退款。"),
      )}
      ${pagination(data, "refunds")}`;
  }

  function noticesMarkup(data) {
    return `${data.items.length ? data.items.map((n) => `<article class="panel" data-notice="${esc(n.id)}">
      <div class="panel-header"><div><p class="eyebrow">${esc(getCinema(n.cinema_id))}</p><h2>${tx("Cinema notice", "影院通知")}</h2></div><span data-notice-state class="badge ${n.read_at ? "" : "warning"}">${n.read_at ? tx("Read", "已读") : tx("Unread", "未读")}</span></div>
      <p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(noticeBody(n.body))}</p>
      <p class="muted">${esc(dateTime(n.created_at))}</p>
      <div class="actions">
        <a class="button secondary" href="${accountURL("orders", { booking: n.booking_id })}">${tx("View booking & compensation", "查看订单与补偿")}</a>
        ${!n.read_at ? `<button class="button ghost" type="button" data-action="read-notice" data-id="${esc(n.id)}">${tx("Mark as read", "标记为已读")}</button>` : ""}
      </div>
    </article>`).join("") : empty(
      tx("No notices yet", "暂无通知"),
      tx("Screening changes and cinema compensation notices will appear here.", "场次变更和影院补偿通知会显示在这里。"),
    )}
      ${pagination(data, "notices")}`;
  }

  function updateBookingActions(actions) {
    const button = actions.querySelector('[data-action="refund-booking"]');
    const reason = bookingActionDisabledReason({
      status: button.dataset.bookingStatus,
      starts_at: button.dataset.startsAt,
      ends_at: button.dataset.endsAt,
    });
    button.disabled = Boolean(reason);
    if (reason) actions.querySelector("[data-reschedule]")?.remove();
    const hint = actions.querySelector("[data-refund-reason]");
    if (hint.textContent !== reason) hint.textContent = reason;
    hint.hidden = !reason;
    return reason;
  }

  function tick() {
    if (!alive) return;
    root.querySelectorAll(".account-refund-actions").forEach(updateBookingActions);
    root.querySelectorAll("[data-expires]").forEach((card) => {
      const remain = Math.max(
        0,
        Math.ceil((Date.parse(card.dataset.expires) - Date.now()) / 1000),
      );
      const clock = card.querySelector("[data-countdown]");
      if (clock) {
        const time = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}`;
        clock.textContent = remain
          ? tx(`${time} remaining`, `剩余 ${time}`)
          : tx("Hold expired. Choose seats again.", "占座已过期，请重新选座。");
      }
      if (!remain) {
        card.querySelector("[data-hold-state]").innerHTML = badge("EXPIRED");
        const resume = card.querySelector("[data-resume]");
        if (resume) {
          resume.removeAttribute("href");
          resume.setAttribute("aria-disabled", "true");
          resume.textContent = tx("Hold expired", "占座已过期");
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
        : tx("Unavailable", "暂不可用");
    if (result.status === "rejected") {
      content.innerHTML = `${notice(result.reason?.userMessage || result.reason?.message || tx("Unable to load your records. Please try again.", "暂时无法加载记录，请重试。"), "error")}<button type="button" class="button secondary" data-action="refresh">${tx("Try again", "重试")}</button>`;
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
    content.innerHTML = `${focus.status === "rejected" ? notice(focus.reason?.userMessage || focus.reason?.message || tx("Unable to load this booking.", "暂时无法加载该订单。"), "error") : ""}${renderers[tab](result.value)}`;
    if (wallet.status === "rejected")
      content.insertAdjacentHTML(
        "afterbegin",
        notice(
          tx("Your balance could not be loaded. Refresh to try again.", "暂时无法查询余额，请刷新后重试。"),
          "warning",
        ),
      );
    tick();
  }

  async function confirmRefund(id, opener) {
    dialog?.remove();
    const d = document.createElement("dialog");
    dialog = d;
    d.className = "panel account-dialog account-refund-dialog";
    d.setAttribute("aria-labelledby", "refund-title");
    d.innerHTML = `<h2 id="refund-title">${tx("Refund your tickets", "申请退票")}</h2>
      <p data-refund-content>${tx("Checking the refund amount…", "正在计算可退款金额…")}</p><div data-refund-error role="alert"></div>
      <div class="actions">
        <button type="button" class="button secondary" data-keep>${tx("Keep my tickets", "保留影票")}</button>
        <button type="button" class="button danger" data-confirm-refund disabled>${tx("Confirm refund", "确认退票")}</button>
      </div>`;
    root.append(d);
    const confirm = d.querySelector("[data-confirm-refund]");
    const keep = d.querySelector("[data-keep]");
    let preview = null;
    let busy = false;
    let needsPreview = true;
    keep.addEventListener("click", () => d.close());
    d.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
    d.addEventListener("close", () => {
      d.remove();
      if (dialog === d) dialog = null;
      opener?.focus();
      if (alive) void load();
    }, { once: true });
    const active = () => alive && d.isConnected;
    const showError = (error) => {
      d.querySelector("[data-refund-error]").innerHTML = notice(error.userMessage || error.message || tx("Unable to confirm this refund.", "暂时无法确认退票。"), "error");
    };
    async function review() {
      confirm.disabled = true;
      d.querySelector("[data-refund-error]").innerHTML = "";
      try {
        preview = await api.request(`/bookings/${encodeURIComponent(id)}/refund-preview`, { method: "POST", body: {}, signal: lifecycle.signal });
        if (!active()) return;
        needsPreview = false;
        const feeRate = Number(preview.fee_rate_bps) / 100;
        const previousFees = money(preview.previous_fees_minor);
        d.querySelector("[data-refund-content]").outerHTML = `<div data-refund-content class="stack">
          <p><strong>${esc(filmTitle(preview.film_title))}</strong><br>${esc(venueName(preview.cinema_name))} · ${esc(auditoriumName(preview.screen_name))}<br>${esc(dateTime(preview.starts_at))}</p>
          <p class="muted">${preview.seats.map((seat) => esc(seatLabel(seat))).join(" / ")}</p>
          <div class="account-refund-amounts">
            <div class="toolbar"><span>${tx("Net ticket value", "折后票款")}</span><strong>${money(preview.ticket_value_minor)}</strong></div>
            <div class="toolbar"><span>${tx(`Cancellation fee (${feeRate}%)`, `退票手续费（${feeRate}%）`)}</span><strong>${Number(preview.fee_minor) ? "−" : ""}${money(preview.fee_minor)}</strong></div>
            <div class="toolbar account-refund-total"><span>${tx("Back to your demo wallet", "退回演示钱包")}</span><strong>${money(preview.refund_minor)}</strong></div>
          </div>
          <p>${tx(
            `All ${preview.seats.length} tickets will be cancelled and their seats released. This cannot be undone; you can book again if seats are available.`,
            `确认后将取消全部 ${preview.seats.length} 张影票并释放座位。退票不可撤销，如果还有空位，可重新购票。`,
          )}</p>
          <p class="muted">${tx(`Previous change fees (${previousFees}) are not refunded.`, `此前的改签手续费（${previousFees}）不退。`)}${preview.coupon_used ? tx(" Your used coupon will not be restored.", "已使用的优惠券不会退回。") : ""} ${tx("No compensation coupon is issued for a voluntary refund. Any pending reschedule for this order will also be released.", "主动退票不发放补偿券。该订单待确认的改签占座也将释放。")}</p>
        </div>`;
        confirm.disabled = false;
        confirm.textContent = `${tx("Confirm refund", "确认退票")} · ${money(preview.refund_minor)}`;
      } catch (error) {
        if (!active()) return;
        showError(error);
        needsPreview = true;
        confirm.disabled = ["BOOKING_STATE", "REFUND_CLOSED", "FORBIDDEN", "NOT_FOUND"].includes(error.code);
        confirm.textContent = tx("Review refund again", "重新查看退款明细");
      }
    }
    confirm.addEventListener("click", async () => {
      if (needsPreview) { await review(); return; }
      busy = true;
      confirm.disabled = true;
      keep.disabled = true;
      confirm.textContent = tx("Refunding…", "正在退票…");
      d.querySelector("[data-refund-error]").innerHTML = "";
      try {
        const receipt = await api.action(`refund:${id}`, `/bookings/${encodeURIComponent(id)}/refund`, { preview_token: preview.preview_token });
        if (!active()) return;
        d.close();
        const refundAmount = money(receipt.refund_minor);
        toast(tx(
          `${refundAmount} returned to your demo wallet. All ticket seats released.`,
          `已退回演示钱包 ${refundAmount}，全部座位已释放。`,
        ));
      } catch (error) {
        if (!active()) return;
        showError(error);
        needsPreview = ["TOKEN_EXPIRED", "PREVIEW_CHANGED"].includes(error.code);
        confirm.disabled = ["BOOKING_STATE", "REFUND_CLOSED", "FORBIDDEN", "NOT_FOUND"].includes(error.code);
        confirm.textContent = needsPreview
          ? tx("Review updated refund", "查看更新的退款明细")
          : tx("Retry this refund", "重试退票");
        // A lost response keeps the exact signed preview and idempotency key for safe recovery.
      } finally {
        busy = false;
        keep.disabled = false;
      }
    });
    d.showModal();
    keep.focus();
    await review();
  }

  function confirmRelease(id, opener) {
    dialog?.remove();
    dialog = document.createElement("dialog");
    dialog.className = "panel account-dialog";
    dialog.setAttribute("aria-labelledby", "release-title");
    dialog.innerHTML = `<h2 id="release-title">${tx("Release these seats?", "释放这些座位？")}</h2>
      <p>${tx("These seats will be available to other customers. If this is a rescheduling hold, your original tickets remain valid.", "释放后，其他观众可以预订这些座位。如果这是改签占座，原影票仍然有效。")}</p>
      <div data-release-error></div><div class="actions">
        <button type="button" class="button secondary" data-keep>${tx("Keep my seats", "保留座位")}</button>
        <button type="button" class="button danger" data-confirm-release>${tx("Release seats", "释放座位")}</button>
      </div>`;
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
        button.textContent = tx("Releasing…", "正在释放…");
        try {
          await api.request(`/holds/${encodeURIComponent(id)}`, {
            method: "DELETE",
          });
          if (!alive) return;
          dialog?.close();
          toast(tx("Seat hold released", "座位已释放"));
          await load();
        } catch (error) {
          if (!alive || !dialog) return;
          dialog.querySelector("[data-release-error]").innerHTML = notice(
            error.userMessage ||
              error.message ||
              tx("Unable to release this hold. Please try again.", "暂时无法释放座位，请重试。"),
            "error",
          );
          button.disabled = false;
          button.textContent = tx("Retry release", "重试释放");
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
      if (button.dataset.action === "view-ticket") {
        closeTicket?.();
        closeTicket = openTicketCard(api, button.dataset.id, button);
        return;
      }
      if (button.dataset.action === "refresh") {
        button.disabled = true;
        await load();
        return;
      }
      if (button.dataset.action === "refund-booking") {
        await confirmRefund(button.dataset.id, button);
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
          state.textContent = tx("Read", "已读");
          state.className = "badge";
          button.remove();
          toast(tx("Notice marked as read", "已标记为已读"));
        } catch (error) {
          if (alive) {
            button.disabled = false;
            toast(
              error.userMessage ||
                error.message ||
                tx("Unable to mark this notice as read. Please try again.", "暂时无法标记为已读，请重试。"),
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
      holder.innerHTML = `<p class="muted">${tx("Loading full booking details…", "正在加载订单详情…")}</p>`;
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
            `${error.userMessage || error.message || tx("Unable to load booking details.", "暂时无法加载订单详情。")} ${tx("Close and reopen this section to try again.", "收起后重新展开可重试。")}`,
            "error",
          );
      } finally {
        delete details.dataset.loading;
      }
    },
    { capture: true, signal: lifecycle.signal },
  );

  // Recheck at activation as the cutoff can pass between two timer ticks.
  function guardReschedule(event) {
    const link = event.target.closest("[data-reschedule]");
    if (link && updateBookingActions(link.closest(".account-refund-actions"))) event.preventDefault();
  }
  root.addEventListener("click", guardReschedule, { signal: lifecycle.signal });
  root.addEventListener("auxclick", guardReschedule, { signal: lifecycle.signal });
  document.addEventListener("visibilitychange", tick, { signal: lifecycle.signal });
  await load();
  if (alive) timer = setInterval(tick, 1000);
  return cleanup;
}

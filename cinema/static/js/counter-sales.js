import { tx } from "./locale.js";
import { filmTitle } from "./film-locale.js";
import { auditoriumName } from "./venue-locale.js";
import { esc, money, dateTime, showError } from "./ui.js";
import { seatGrid, seatLabel } from "./seat-grid.js";

export async function createCounterSales(api, user, openBooking, statusText) {
  const key = `falcons.counter.${user.id}.${user.staff_cinema_id}`;
  let pending = JSON.parse(sessionStorage.getItem(key) || "null");
  let receipt, map, current, root, view, loading = false;
  let email = "", source = "", useCoupon = false;
  let selected = new Map();
  const shows = await api.request("/counter/screenings");
  const showText = s => `${dateTime(s.starts_at)} · ${filmTitle(s.film_title)} · ${auditoriumName(s.screen_name)}`;
  const fareText = type => type === "STUDENT" ? tx("Student", "学生票") : tx("Standard", "标准票");
  const errorBox = '<p data-error role="alert" tabindex="-1" hidden></p>';
  const moneyLabel = amount => amount < 0 ? tx("Return to balance", "退回余额") : tx("Wallet charge", "余额扣款");

  function html() {
    let body;
    if (receipt) {
      const label = receipt.status === "CONFIRMED" ? tx("Tickets issued", "已出票") : statusText(receipt.status);
      body = `<p role="status">${esc(label)} · ${tx("Booking", "订单")} ${esc(receipt.booking_id)}</p>
        <div class="actions"><button class="button" data-next>${tx("Next customer", "办理下一单")}</button>
        <button class="button secondary" data-booking>${tx("View booking", "查看订单")}</button></div>`;
    } else if (pending) {
      body = `<form class="stack" data-confirm><p>${esc(showText(pending.screening))}<br>${esc(pending.seats.map(seatLabel).join(" · "))}</p>
        <div class="summary-line"><span>${moneyLabel(pending.amount_due_minor)}</span><strong>${money(Math.abs(pending.amount_due_minor))}</strong></div>
        <p>${tx("Code sent to", "验证码已发送至")} ${esc(pending.recipient)} · ${tx("Valid until", "有效至")} ${dateTime(pending.expires_at)}</p>
        <label class="field"><span>${tx("Customer’s email code", "顾客的邮箱验证码")}</span><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" required></label>
        ${errorBox}<div class="actions"><button class="button" type="submit">${tx("Verify & issue tickets", "验证并出票")}</button>
        <button type="button" class="button secondary" data-resend>${tx("Resend code", "重发验证码")}</button>
        <button type="button" class="button ghost" data-edit>${tx("Edit sale", "修改交易")}</button></div></form>`;
    } else if (!shows.length) {
      body = `<p class="muted">${tx("This branch has no screenings on sale.", "本店暂无可售场次。")}</p>`;
    } else {
      body = `<form class="stack" data-sale><label class="field"><span>${tx("Branch screening", "本店场次")}</span>
        <select name="screening" required><option value="">${tx("Select a screening", "请选择场次")}</option>
        ${shows.map(s => `<option value="${esc(s.id)}" ${s.id === current?.id ? "selected" : ""}>${esc(showText(s))}</option>`).join("")}</select></label>
        ${loading ? `<p role="status">${tx("Loading seats…", "正在加载座位…")}</p>` : ""}
        ${map ? seatGrid(map, selected, map.saleable) : ""}
        ${map && !map.saleable ? `<p>${tx("This screening is closed.", "本场次已停止售票。")}</p>` : ""}
        <div data-fares>${fares()}</div>
        <label class="field"><span>${tx("Customer’s registered email", "顾客注册邮箱")}</span><input name="email" type="email" maxlength="254" autocomplete="off" value="${esc(email)}" required></label>
        <details><summary>${tx("Coupon or booking change", "使用优惠券或办理改签")}</summary>
        <label><input name="coupon" type="checkbox" ${useCoupon ? "checked" : ""}> ${tx("Use an available branch coupon", "使用本店可用优惠券")}</label>
        <label class="field"><span>${tx("Original booking number for a change", "改签时填写原订单号")}</span><input name="source" inputmode="numeric" pattern="[0-9]+" value="${esc(source)}"></label></details>
        ${errorBox}<div class="actions"><button class="button" type="submit" ${map?.saleable && selected.size ? "" : "disabled"}>${tx("Email verification code", "发送邮箱验证码")}</button></div></form>`;
    }
    return `<section class="panel" data-counter-sale><h2>${tx("Counter sales", "柜台售票")}</h2>${body}</section>`;
  }

  function fares() {
    if (!selected.size) return "";
    return [...selected].map(([id, fare]) => {
      const seat = map.seats.find(s => s.id === id);
      return `<label class="field"><span>${esc(seatLabel(seat))}</span><select name="fare-${esc(id)}" data-fare="${esc(id)}">
        ${map.fares.map(f => `<option value="${esc(f.fare_type)}" ${fare === f.fare_type ? "selected" : ""}>${fareText(f.fare_type)} · ${money(f.price_minor)}</option>`).join("")}</select></label>`;
    }).join("");
  }

  function redraw() {
    if (!view?.isConnected) return;
    root.innerHTML = html();
    bind(root);
  }

  async function loadSeats(id) {
    current = shows.find(s => s.id === id);
    map = null;
    selected.clear();
    loading = Boolean(current);
    redraw();
    if (!current) return;
    const target = current;
    try {
      const result = await api.request(`/screenings/${id}/seats`);
      if (current === target) map = result;
    } catch (error) {
      if (current !== target) return;
      current = null;
      loading = false;
      redraw();
      if (view?.isConnected) showError(view.querySelector("[data-error]"), error, true);
      return;
    }
    if (current === target) { loading = false; redraw(); }
  }

  function bind(container) {
    root = container;
    view = root.querySelector("[data-counter-sale]");
    const form = view.querySelector("form");
    if (receipt) {
      view.querySelector("[data-next]").onclick = () => {
        receipt = null; current = null; map = null; selected.clear(); email = ""; source = ""; useCoupon = false;
        redraw();
      };
      view.querySelector("[data-booking]").onclick = () => openBooking(receipt.booking_id);
    }
    if (!form) return;
    const resend = form.querySelector("[data-resend]");
    if (resend) resend.onclick = () => submit(form, async () => {
      const result = await api.request(`/counter/sales/${pending.sale_id}/resend`, { method: "POST" });
      pending = { ...pending, ...result };
      sessionStorage.setItem(key, JSON.stringify(pending));
    });
    const edit = form.querySelector("[data-edit]");
    if (edit) edit.onclick = () => {
      pending = null;
      sessionStorage.removeItem(key);
      if (current) loadSeats(current.id);
      else redraw();
    };
    form.oninput = () => {
      if (form.elements.email) {
        email = form.elements.email.value;
        source = form.elements.source.value;
        useCoupon = form.elements.coupon.checked;
      }
    };
    form.onchange = e => {
      if (e.target.name === "screening") loadSeats(e.target.value);
      if (e.target.dataset.fare) selected.set(e.target.dataset.fare, e.target.value);
    };
    form.onclick = e => {
      const seat = e.target.closest("[data-seat]");
      if (!seat || form.dataset.busy) return;
      const id = seat.dataset.seat;
      if (selected.has(id)) selected.delete(id);
      else if (selected.size < 12) selected.set(id, "STANDARD");
      else {
        showError(form.querySelector("[data-error]"), new Error(tx("Select up to 12 seats.", "每单最多选择 12 个座位。")), true);
        return;
      }
      form.querySelector("[data-error]").hidden = true;
      seat.setAttribute("aria-pressed", String(selected.has(id)));
      form.querySelector("[data-fares]").innerHTML = fares();
      form.querySelector('[type="submit"]').disabled = !selected.size;
    };
    form.onsubmit = e => {
      e.preventDefault();
      submit(form, async () => {
        if (pending) {
          receipt = await api.request(`/counter/sales/${pending.sale_id}/confirm`, {
            method: "POST", body: { code: form.elements.code.value },
          });
          pending = null;
          sessionStorage.removeItem(key);
        } else {
          const result = await api.request("/counter/codes", { method: "POST", body: {
            email: email.trim(), screening_id: current.id, source_booking_id: source.trim() || null,
            use_coupon: useCoupon, tickets: [...selected].map(([seat_id, fare_type]) => ({ seat_id, fare_type })),
          } });
          pending = { ...result, screening: current, seats: map.seats.filter(s => selected.has(s.id))
            .map(({ row_no, seat_no }) => ({ row_no, seat_no })), recipient: email.replace(/^(.).*@/, "$1…@") };
          sessionStorage.setItem(key, JSON.stringify(pending));
        }
      });
    };
  }

  async function submit(form, action) {
    if (form.dataset.busy) return;
    form.dataset.busy = "1";
    form.setAttribute("aria-busy", "true");
    const controls = [...form.elements].filter(el => !el.disabled);
    controls.forEach(el => { el.disabled = true; });
    try {
      await action();
      redraw();
    } catch (err) {
      if (!pending && err.code === "SEAT_UNAVAILABLE") await loadSeats(current.id);
      if (view.isConnected) showError(view.querySelector("[data-error]"), err, true);
    } finally {
      delete form.dataset.busy;
      form.removeAttribute("aria-busy");
      controls.forEach(el => { el.disabled = false; });
    }
  }
  return { html, bind };
}

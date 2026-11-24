import { createCounterSales } from "./counter-sales.js";
import { getLanguage, tx } from "./locale.js";
import { filmTitle, genreName } from "./film-locale.js";
import { venueName, venueAddress, venueBrand, districtLabel, auditoriumName } from "./venue-locale.js";
import { esc, money, dateTime, showError, redrawLocalized, LocalizedError } from "./ui.js";

const statuses = {
  PUBLISHED: ["Published", "已发布"],
  CANCELLED: ["Cancelled", "已取消"],
  CONFIRMED: ["Confirmed", "已出票"],
  RESCHEDULED: ["Rescheduled", "已改签"],
  CINEMA_CANCELLED: ["Cinema cancellation", "影院取消"],
  CUSTOMER_CANCELLED: ["Customer refunded", "顾客已退票"],
  PENDING: ["Pending refund", "待退款"],
  FAILED: ["Needs retry", "待重试"],
  SUCCEEDED: ["Completed", "已完成"],
  STANDARD: ["Standard", "标准"],
  STUDENT: ["Student", "学生"],
  IMAX: ["IMAX", "IMAX"],
  DOLBY_CINEMA: ["Dolby Cinema", "杜比影院"],
  ONLINE: ["Online", "线上"],
  COUNTER: ["Counter", "柜台"],
};
const statusText = value => Object.hasOwn(statuses, value) ? tx(...statuses[value]) : value;
const status = (value) =>
  `<span class="badge status ${esc(value)}">${esc(statusText(value))}</span>`;
const rowsOf = (value) => (Array.isArray(value) ? value : value?.items || []);
const input = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value ?? "")}" ${extra}></label>`;
const textarea = (label, name, value = "", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
const select = (label, name, options, value = "", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}" aria-label="${esc(label)}" ${extra}>${options.map(([id, title]) => `<option value="${esc(id)}" ${String(id) === String(value) ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>`;
const button = (text, action, id = "", kind = "secondary") =>
  `<button type="button" class="button ${kind}" data-act="${action}" data-id="${esc(id)}">${text}</button>`;
const table = (head, rows, fallback) =>
  rows.length
    ? `<div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><strong>${esc(fallback || tx("No records yet", "暂无记录"))}</strong><p class="muted">${tx("Records will appear here after the relevant activity.", "有相关操作后，记录会出现在这里。")}</p></div>`;
const alertBox = (text) => `<div class="notice">${esc(text)}</div>`;
const beijingNow = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
const zoned = (value) => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new LocalizedError("Choose a valid date and time in Beijing time.", "请选择有效的北京时间。");
  return `${value}:00+08:00`;
};
const fen = (value) => {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match)
    throw new LocalizedError("Enter a positive fare with at most two decimal places.", "请输入大于零的票价，最多保留两位小数。");
  const amount =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (amount <= 0 || amount > 10000000)
    throw new LocalizedError("Fares must be between ¥0.01 and ¥100,000.00.", "票价须在 0.01 元至 100,000 元之间。");
  return amount;
};
const yuan = (value) => (value == null ? "" : (Number(value) / 100).toFixed(2));
const short = (value) => String(value || "").slice(-8);

/** Branch and platform workspaces. All mutations use server role/scope enforcement. */
export async function renderOperations(ctx) {
  const { root, api, user, bootstrap, toast } = ctx;
  const admin = user.role === "PLATFORM_ADMIN";
  if (!admin && user.role !== "STAFF") {
    ctx.updateLanguage = () => {
      root.innerHTML = alertBox(
        tx("Sign in with a cinema staff or platform administrator account to use this workspace.", "请使用影院员工或平台管理员账号登录工作台。"),
      );
    };
    ctx.updateLanguage();
    return;
  }
  root.classList.add("operations-view");
  let alive = true,
    revision = 0,
    currentTab = admin ? "cinemas" : "programme",
    bookingQuery = "",
    staffCinemaFilter = "";
  const refundRecords = new Map();
  let cinemas = rowsOf(bootstrap.cinemas),
    districts = rowsOf(bootstrap.districts),
    genres = rowsOf(bootstrap.genres),
    films = rowsOf(bootstrap.films),
    screens = [],
    staff = [];
  const dialogs = new Set();
  const tabs = () => admin
    ? [
        ["cinemas", tx("Cinemas", "影院")],
        ["films", tx("Films & genres", "影片与类型")],
        ["staff", tx("Staff & managers", "员工与经理")],
        ["turnover", tx("Turnover", "营业额")],
        ["community", tx("Community moderation", "社区管理")],
      ]
    : [
        ["programme", tx("Screenings & fares", "排片与票价")],
        ["layouts", tx("Auditoriums & seats", "影厅与座位")],
        ["counter", tx("Counter sales", "柜台售票")],
        ["bookings", tx("Branch bookings", "本店订单")],
        ["refunds", tx("Refunds", "退款")],
        ...(user.is_manager ? [["turnover", tx("Turnover", "营业额")]] : []),
      ];
  const cinemaName = (id) =>
    venueName(cinemas.find((c) => String(c.id) === String(id))?.name) || tx("Your cinema", "所属影院");
  const filmName = (id) =>
    filmTitle(films.find((f) => String(f.id) === String(id))) ||
    tx(`Film ${short(id)}`, `影片 ${short(id)}`);
  const screenName = (id) =>
    auditoriumName(screens.find((s) => String(s.id) === String(id))?.name) ||
    tx(`Auditorium ${short(id)}`, `影厅 ${short(id)}`);
  const districtName = (id) =>
    districtLabel(districts.find((d) => String(d.id) === String(id))) || tx("Not set", "未设置");
  const heading = () => `
    <div class="page-heading${admin ? "" : " branch-heading"}">
      <div>
        <p class="eyebrow">${admin ? tx("PLATFORM CONSOLE", "平台控制台") : tx("CINEMA WORKSPACE", "影院运营")}</p>
        <h1>${admin ? tx("Platform management", "平台管理") : tx("Cinema workspace", "影院工作台")}</h1>
        ${admin ? `<p class="muted">${tx("Manage the shared catalogue, cinemas and staff, and review branch settlements.", "管理全平台的片库、影院和员工，查看各门店结算情况。")}</p>` : ""}
      </div>
      ${admin ? "" : `<div class="branch-heading-details">
        <p><strong>${esc(cinemaName(user.staff_cinema_id))} · ${user.is_manager ? tx("Manager", "经理") : tx("Staff", "员工")}</strong></p>
        <p class="muted">${tx("All times are Beijing time", "所有时间均为北京时间")}</p>
      </div>`}
    </div>
    <nav class="tabs" data-operations-nav aria-label="${tx("Operations navigation", "工作台导航")}">
      ${tabs().map(([id, label]) => `<button class="tab ${id === currentTab ? "active" : ""}" data-tab="${id}" aria-pressed="${id === currentTab}" type="button">${label}</button>`).join("")}
    </nav>`;
  root.innerHTML = `<div data-workspace-heading>${heading()}</div><div class="operations-body stack" aria-live="polite"></div>`;
  const content = root.querySelector(".operations-body");
  const errorText = (err) =>
    err?.userMessage ||
    err?.message ||
    tx("The action could not be completed. Please try again.", "操作未能完成，请重试。");
  function bindActions(container, handler) {
    container.onclick = (event) => {
      const target = event.target.closest("[data-act]");
      if (target && container.contains(target))
        handler(target.dataset.act, target.dataset.id, target);
    };
  }
  function formAction(form, callback) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.dataset.busy) return;
      const error = form.querySelector("[data-error]");
      if (error) {
        error.hidden = true;
        error.textContent = "";
      }
      const submit = form.querySelector("[type=submit]");
      const old = submit?.textContent;
      form.dataset.busy = "1";
      if (submit) {
        submit.disabled = true;
        submit.textContent = tx("Working…", "处理中…");
      }
      try {
        await callback(new FormData(form), form);
      } catch (err) {
        if (error) {
          showError(error, err, true);
          error.focus();
        } else toast(errorText(err), "error");
      } finally {
        delete form.dataset.busy;
        if (submit) {
          submit.disabled = false;
          submit.textContent = old;
        }
        if (content.contains(form) && pendingLanguage) ctx.updateLanguage();
      }
    });
  }
  function dialog(title, body) {
    const trigger = document.activeElement;
    const titleId = `operations-dialog-title-${dialogs.size + 1}`;
    const d = document.createElement("dialog");
    d.className = "modal-dialog operations-dialog";
    d.setAttribute("aria-labelledby", titleId);
    d.innerHTML = `<div class="panel-header"><h2 id="${titleId}">${esc(title)}</h2><button type="button" class="button ghost" data-close aria-label="${tx("Close dialog", "关闭对话框")}">${tx("Close ×", "关闭 ×")}</button></div><div class="stack">${body}</div>`;
    document.body.append(d);
    dialogs.add(d);
    d.querySelector("[data-close]").onclick = () => d.close();
    d.addEventListener("close", () => {
      dialogs.delete(d);
      d.remove();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
    d.showModal();
    d.querySelector("[data-close]")?.focus({ preventScroll: true });
    return d;
  }
  const formEnd = (label = tx("Save", "保存"), kind = "") =>
    `<p class="error" role="alert" tabindex="-1" data-error hidden></p><div class="actions"><button type="submit" class="button ${kind}">${label}</button></div>`;
  const panel = (title, body, action = "") =>
    `<section class="panel"><div class="panel-header"><h2>${title}</h2>${action}</div>${body}</section>`;
  async function reload() {
    if (ctx.refresh) await ctx.refresh();
    await showTab(currentTab);
  }
  async function request(path, method = "GET", body) {
    return api.request(path, {
      method,
      ...(body === undefined ? {} : { body }),
    });
  }
  async function fetchScreens() {
    screens = rowsOf(await request("/staff/screens"));
    return screens;
  }
  async function fetchAdmin() {
    const values = await Promise.all([
      request("/admin/cinemas"),
      request("/admin/staff"),
    ]);
    cinemas = rowsOf(values[0]);
    staff = rowsOf(values[1]);
  }
  let renderPanel, bindPanel, disposePanel, pendingLanguage = false;
  const results = new Map();
  const loading = () => `<div class="panel"><p class="muted">${tx("Loading…", "加载中…")}</p></div>`;
  function showResult(selector, render) {
    if (!content.querySelector(selector)) return;
    results.set(selector, render);
    content.querySelector(selector).innerHTML = render();
  }
  ctx.updateLanguage = () => {
    root.querySelector("[data-workspace-heading]").innerHTML = heading();
    if (!renderPanel) { content.innerHTML = loading(); return; }
    pendingLanguage = Boolean(content.querySelector("form[data-busy]"));
    if (pendingLanguage) return;
    redrawLocalized(content, () => { content.innerHTML = renderPanel(); }, bindPanel);
    for (const [selector, render] of results) showResult(selector, render);
  };
  async function showTab(tab, page = 1) {
    disposePanel?.();
    disposePanel = null;
    pendingLanguage = false;
    results.clear();
    renderPanel = null;
    currentTab = tab;
    const token = ++revision;
    root.querySelectorAll("[data-tab]").forEach((el) => {
      const selected = el.dataset.tab === tab;
      el.classList.toggle("active", selected);
      el.setAttribute("aria-pressed", String(selected));
    });
    const route = new URL(location.href);
    route.hash = "/operations?" + new URLSearchParams({ tab });
    history.replaceState(null, "", route);
    content.innerHTML = loading();
    try {
      let render, counterView;
      if (tab === "programme") render = await programme(page);
      else if (tab === "layouts") render = await layouts();
      else if (tab === "counter") {
        counterView = await createCounterSales(api, user, bookingDialog, statusText);
        render = counterView.html;
      }
      else if (tab === "bookings") render = await bookings(page);
      else if (tab === "refunds") render = await refunds(page);
      else if (tab === "cinemas") render = await cinemaPanel();
      else if (tab === "films") render = await filmPanel(page);
      else if (tab === "staff") render = await staffPanel();
      else if (tab === "community") render = await moderationPanel(page);
      else if (tab === "turnover") {
        if (admin) await fetchAdmin();
        render = turnoverPanel;
      }
      if (!alive || token !== revision) return;
      renderPanel = render;
      disposePanel = counterView?.dispose;
      bindPanel = counterView ? () => counterView.bind(content) : () => bindCurrent(tab, page);
      content.innerHTML = renderPanel();
      bindPanel();
    } catch (err) {
      if (alive && token === revision) {
        renderPanel = () => `<div class="panel"><p class="error" role="alert">${esc(errorText(err))}</p>${button(tx("Reload", "重新加载"), "reload")}</div>`;
        bindPanel = () => bindActions(content, () => reload());
        content.innerHTML = renderPanel();
        bindPanel();
      }
    }
  }
  root
    .querySelector("[data-workspace-heading]")
    .addEventListener("click", (event) => {
      const b = event.target.closest("[data-tab]");
      if (b) showTab(b.dataset.tab);
    });
  const pager = (page, hasNext) =>
    `<div class="actions">${page > 1 ? button(tx("Previous", "上一页"), "previous") : ""}<span class="muted">${tx(`Page ${page}`, `第 ${page} 页`)}</span>${hasNext ? button(tx("Next", "下一页"), "next") : ""}</div>`;
  const layoutOptions = () =>
    screens.flatMap((s) =>
      (s.layouts || []).map((l) => [
        l.id,
        `${auditoriumName(s.name)} · ${tx(`Layout v${l.version_no} · ${l.row_count} rows`, `布局 v${l.version_no} · ${l.row_count} 排`)}`,
      ]),
    );
  function programmeFields(s = {}) {
    return `<div class="form-grid">${select(
      tx("Film", "影片"),
      "film_id",
      films.filter((f) => !f.archived).map((f) => [f.id, filmTitle(f)]),
      s.film_id,
      "required",
    )}${select(tx("Auditorium / layout version", "影厅及座位布局版本"), "layout_id", layoutOptions(), s.layout_id, "required")}${input(tx("Starts at (Beijing time)", "开场时间（北京时间）"), "starts_at", s.starts_at?.slice(0, 16) || "", "datetime-local", "required")}${input(tx("Standard fare (CNY)", "标准票价（元）"), "STANDARD", s.STANDARD || "65.00", "number", 'min="0.01" max="100000" step="0.01" required')}${input(tx("Student fare (CNY)", "学生票价（元）"), "STUDENT", s.STUDENT || "40.00", "number", 'min="0.01" max="100000" step="0.01" required')}</div>`;
  }
  const programmeBody = (fd) => ({
    film_id: fd.get("film_id"),
    layout_id: fd.get("layout_id"),
    starts_at: zoned(fd.get("starts_at")),
    fares: {
      STANDARD: fen(fd.get("STANDARD")),
      STUDENT: fen(fd.get("STUDENT")),
    },
  });

  async function programme(page) {
    const [result] = await Promise.all([
      request(`/staff/screenings?page=${page}`),
      fetchScreens(),
    ]);
    const missing = [
      ...new Set(result.items.map((s) => String(s.film_id))),
    ].filter((id) => !films.some((f) => String(f.id) === id));
    const details = await Promise.allSettled(
      missing.map((id) => request(`/films/${id}`)),
    );
    details.forEach((result) => {
      if (result.status === "fulfilled") films.push(result.value);
    });
    return () => panel(
      tx("Screenings", "放映场次"),
      alertBox(
        tx("Allow 15 minutes between screenings for turnaround. To change a published screening’s time, film or auditorium, use Cancel / replace.", "请在两场放映之间预留 15 分钟清场。要更改已发布场次的时间、影片或影厅，请选择“取消或替换”。"),
      ) +
        table(
          [tx("Film / auditorium", "影片 / 影厅"), tx("Start / end", "开场 / 散场"), tx("Status", "状态"), tx("Version", "版本"), tx("Actions", "操作")],
          result.items.map((s) => [
            `<strong>${esc(filmTitle(s.film_title) || filmName(s.film_id))}</strong><div class="muted">${esc(auditoriumName(s.screen_name) || screenName(s.screen_id))}</div>`,
            `${dateTime(s.starts_at)}<div class="muted">${tx(`until ${dateTime(s.ends_at)}`, `至 ${dateTime(s.ends_at)}`)}</div>`,
            status(s.status),
            `v${esc(s.revision_no)}`,
            s.status === "PUBLISHED" && new Date(s.starts_at) > new Date()
              ? `${button(tx("Fares", "票价"), "fares", s.id)} ${button(tx("Cancel / replace", "取消或替换"), "cancel", s.id, "ghost")}`
              : `<span class="muted">${tx("Closed", "已结束")}</span>`,
          ]),
          tx("No screenings yet", "暂无排片"),
        ) +
        pager(page, result.items.length === 100),
      button(tx("＋ Publish screening", "＋ 发布场次"), "publish", "", ""),
    );
  }
  async function publishDialog() {
    if (!layoutOptions().length) {
      toast(tx("Create an auditorium and a seating layout first.", "请先创建影厅并设置座位布局。"), "error");
      return;
    }
    const d = dialog(
      tx("Publish a screening", "发布放映场次"),
      `<form class="stack">${programmeFields()}${alertBox(tx("The auditorium is reserved for the film duration plus 15 minutes for turnaround. Fares apply to this screening only.", "影厅占用时间包括影片时长和 15 分钟清场时间。此处设置的票价仅适用于本场。"))}${formEnd(tx("Publish screening", "发布场次"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request("/staff/screenings", "POST", programmeBody(fd));
      d.close();
      toast(tx("Screening published.", "场次已发布。"));
      await reload();
    });
  }
  async function fareDialog(id) {
    const data = await request(`/screenings/${id}/seats`);
    const fares = Object.fromEntries(
      data.fares.map((f) => [f.fare_type, f.price_minor]),
    );
    const d = dialog(
      tx("Update screening fares", "修改场次票价"),
      `<form class="stack"><p>${esc(filmName(data.screening.film_id))} · ${dateTime(data.screening.starts_at)}</p><div class="form-grid">${input(tx("Standard fare (CNY)", "标准票价（元）"), "STANDARD", yuan(fares.STANDARD), "number", 'min="0.01" max="100000" step="0.01" required')}${input(tx("Student fare (CNY)", "学生票价（元）"), "STUDENT", yuan(fares.STUDENT), "number", 'min="0.01" max="100000" step="0.01" required')}</div>${alertBox(tx("Unpaid reservations will need a fresh quote. Prices on issued tickets remain unchanged.", "未付款的订单需重新核价。已出票的订单保留原票价。"))}${formEnd(tx("Save fares", "保存票价"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(`/staff/screenings/${id}/fares`, "PUT", {
        revision_no: data.screening.revision_no,
        fares: {
          STANDARD: fen(fd.get("STANDARD")),
          STUDENT: fen(fd.get("STUDENT")),
        },
      });
      d.close();
      toast(tx("Fares updated.", "票价已更新。"));
      await reload();
    });
  }
  async function cancelDialog(id) {
    const data = await request(`/screenings/${id}/seats`);
    const s = data.screening;
    const fareValues = Object.fromEntries(
      data.fares.map((f) => [f.fare_type, yuan(f.price_minor)]),
    );
    const d = dialog(
      tx("Cancel / replace screening", "取消或替换场次"),
      `<form class="stack"><p><strong>${esc(filmName(s.film_id))}</strong> · ${dateTime(s.starts_at)}</p>${textarea(tx("Reason shown to customers", "向顾客展示的取消原因"), "reason", "", 'required maxlength="500"')}<label class="field"><span><input type="checkbox" name="with_replacement"> ${tx("Publish a replacement screening", "发布替代场次")}</span></label><fieldset data-replacement hidden disabled><legend>${tx("Replacement screening", "替代场次")}</legend>${programmeFields({ ...s, ...fareValues })}</fieldset>${alertBox(tx("Active bookings will be cancelled. Refunds cover current net tickets and all accumulated change fees, with one same-cinema 50% coupon per booking. Customers are not automatically moved to the replacement.", "取消后将退还有效订单的实付票款及累计改签费，每笔订单另获一张本店五折券。顾客需自行预订替代场次。"))}${formEnd(tx("Preview impact", "预览取消影响"))}</form>`,
    );
    const form = d.querySelector("form");
    form.elements.with_replacement.onchange = () => {
      const field = d.querySelector("[data-replacement]");
      field.hidden = !form.elements.with_replacement.checked;
      field.disabled = field.hidden;
    };
    formAction(form, async (fd) => {
      const body = { reason: fd.get("reason") };
      if (fd.get("with_replacement")) body.replacement = programmeBody(fd);
      const preview = await request(
        `/staff/screenings/${id}/cancellation-preview`,
        "POST",
        body,
      );
      d.close();
      cancelConfirmation(id, preview, s);
    });
  }
  function cancelConfirmation(id, p, s) {
    const d = dialog(
      tx("Confirm cancellation", "确认取消"),
      `<form class="stack"><p><strong>${esc(filmName(s.film_id))}</strong><br>${esc(screenName(s.screen_id))} · ${dateTime(s.starts_at)}</p><p>${esc(p.reason)}</p><div class="metric-grid"><div class="metric"><span>${tx("Confirmed bookings", "已确认订单")}</span><strong>${esc(p.booking_count)}</strong></div><div class="metric"><span>${tx("Refund total", "退款总额")}</span><strong>${money(p.refund_total_minor)}</strong></div><div class="metric"><span>${tx("Compensation coupons", "补偿券")}</span><strong>${esc(p.coupon_count)}</strong></div></div>${p.replacement ? alertBox(tx(`Replacement: ${filmName(p.replacement.film_id)}, ${dateTime(p.replacement.starts_at)}.`, `替代场次：${filmName(p.replacement.film_id)}，${dateTime(p.replacement.starts_at)}。`)) : ""}${table(
        [tx("Affected bookings", "受影响的订单"), tx("Ticket value", "票款"), tx("Cumulative fees", "累计改签费")],
        (p.bookings || []).map((b) => [
          `…${esc(short(b.id))}`,
          money(b.net_ticket_minor),
          money(b.cumulative_fee_minor),
        ]),
        tx("No paid bookings", "暂无已付款订单"),
      )}${alertBox(tx("Cancellation takes effect immediately. Refunds and coupons are tracked separately; check Refunds for settlement status. A changed preview requires another review.", "取消将立即生效。退款和优惠券分别记录，可在“退款”中查看到账情况。预览内容如有变动，需重新确认。"))}${formEnd(tx("Confirm cancellation & refunds", "确认取消并退款"), "danger")}</form>`,
    );
    formAction(d.querySelector("form"), async () => {
      const result = await api.action(
        `cancel-screening:${id}`,
        `/staff/screenings/${id}/cancel`,
        { preview_token: p.preview_token },
      );
      d.close();
      toast(
        tx(`Screening cancelled; ${result.coupon_count} compensation coupons issued.`, `场次已取消，已发放 ${result.coupon_count} 张补偿券。`),
      );
      await reload();
    });
  }

  async function layouts() {
    await fetchScreens();
    return () => panel(
      tx("Auditoriums & layouts", "影厅与座位布局"),
      alertBox(
        tx("Seat changes create a new layout version. Existing screenings keep their original layout. Scheduling checks use the physical auditorium across all versions.", "修改座位将创建新版布局，已排场次沿用原布局。同一影厅的各版本共用排期，放映时间不可冲突。"),
      ) +
        table(
          [tx("Auditorium", "影厅"), tx("Type", "类型"), tx("Layout version", "布局版本"), tx("Actions", "操作")],
          screens.map((s) => [
            `<strong>${esc(auditoriumName(s.name))}</strong>`,
            status(s.screen_type),
            (s.layouts || [])
              .map(
                (l) =>
                  `<button type="button" class="button ghost" data-act="view-layout" data-id="${esc(l.id)}">v${esc(l.version_no)} · ${tx(`${esc(l.row_count)} rows`, `${esc(l.row_count)} 排`)}</button>`,
              )
              .join(" ") || `<span class="muted">${tx("Not created", "尚未创建")}</span>`,
            button(tx("Create layout version", "新建布局版本"), "create-layout", s.id),
          ]),
          tx("No auditoriums yet", "暂无影厅"),
        ),
      button(tx("＋ Add auditorium", "＋ 添加影厅"), "create-screen", "", ""),
    );
  }
  function screenDialog() {
    const d = dialog(
      tx("Add auditorium", "添加影厅"),
      `<form class="stack">${input(tx("Auditorium name", "影厅名称"), "name", "", "text", 'required maxlength="80"')}${select(
        tx("Screen type", "影厅类型"),
        "screen_type",
        [
          ["STANDARD", tx("Standard auditorium", "标准厅")],
          ["IMAX", "IMAX"],
          ["DOLBY_CINEMA", tx("Dolby Cinema", "杜比影院")],
        ],
      )}${formEnd(tx("Add auditorium", "添加影厅"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request("/staff/screens", "POST", Object.fromEntries(fd));
      d.close();
      toast(tx("Auditorium added. Create its seating layout next.", "影厅已添加，请设置座位布局。"));
      await reload();
    });
  }
  function makeLayout(fd) {
    const rowCount = Number(fd.get("rows"));
    const segments = String(fd.get("segments"))
      .split(/[，,]/)
      .map((s) => Number(s.trim()));
    const direction = fd.get("direction");
    if (
      !Number.isInteger(rowCount) ||
      rowCount < 1 ||
      rowCount > 100 ||
      !segments.length ||
      segments.length > 8 ||
      segments.some((n) => !Number.isInteger(n) || n < 1 || n > 100)
    )
      throw new LocalizedError("Use 1–100 rows and 1–100 seats per segment, with at most 8 segments.", "请设置 1–100 排，每个座区每排 1–100 座，最多可设 8 个座区。");
    const width = segments.reduce((a, b) => a + b, 0) + segments.length - 1;
    if (rowCount * segments.reduce((a, b) => a + b, 0) > 5000)
      throw new LocalizedError("A layout can contain at most 5,000 seats.", "每个布局最多可设置 5,000 个座位。");
    const seats = [];
    for (let row = 1; row <= rowCount; row++) {
      let no = 1,
        x = 0;
      segments.forEach((count, segment) => {
        for (let pos = 1; pos <= count; pos++) {
          const across = x;
          const depth = row - 1;
          let mapX = across,
            mapY = depth;
          if (direction === "BOTTOM") mapY = rowCount - 1 - depth;
          if (direction === "LEFT") {
            mapX = depth;
            mapY = across;
          }
          if (direction === "RIGHT") {
            mapX = rowCount - 1 - depth;
            mapY = across;
          }
          seats.push({
            row_no: row,
            seat_no: no++,
            aisle_segment: segment + 1,
            segment_position: pos,
            map_x: mapX,
            map_y: mapY,
          });
          x++;
        }
        x++;
      });
    }
    return { row_count: rowCount, screen_direction: direction, seats, width };
  }
  function layoutMap(layout) {
    return `<div class="notice">${tx("Screen position:", "银幕位置：")} ${{ TOP: tx("Top", "上方"), BOTTOM: tx("Bottom", "下方"), LEFT: tx("Left", "左侧"), RIGHT: tx("Right", "右侧") }[layout.screen_direction]}${tx(`. Row 1 is nearest the screen. ${layout.seats.length} seats.`, `。第 1 排最靠近银幕，共 ${layout.seats.length} 个座位。`)}</div><div style="overflow:auto;padding:12px 0;max-height:340px"><div style="display:grid;grid-auto-columns:32px;grid-auto-rows:28px;gap:5px;width:max-content;margin:auto">${layout.seats.map((s) => `<span class="badge" title="${tx(`Row ${s.row_no}, seat ${s.seat_no} · segment ${s.aisle_segment}`, `第 ${s.row_no} 排 ${s.seat_no} 座 · 第 ${s.aisle_segment} 座区`)}" style="grid-column:${s.map_x + 1};grid-row:${s.map_y + 1};padding:3px;text-align:center;font-size:10px">${s.row_no}-${s.seat_no}</span>`).join("")}</div></div>`;
  }
  async function layoutDialog(screenId) {
    const recommended = await request(`/staff/screens/${screenId}/layout-template`);
    const d = dialog(
      tx(`${screenName(screenId)} · Create layout version`, `${screenName(screenId)} · 新建布局版本`),
      `<form class="stack">${select(tx("Seating plan", "座位方案"), "layout_mode", [["recommended", tx("Recommended for this screen format", "此厅型的推荐布局")], ["custom", tx("Custom layout", "自定义布局")]], "recommended")}<div class="form-grid" data-custom-layout hidden>${input(tx("Number of rows", "排数"), "rows", "12", "number", 'min="1" max="100" required')}${input(tx("Seats per aisle segment", "各座区每排座位数"), "segments", "3,3", "text", `required placeholder="${tx("For example: 3,4,3", "例如：3,4,3")}"`)}${select(
        tx("Screen position", "银幕位置"),
        "direction",
        [
          ["TOP", tx("Top", "上方")],
          ["BOTTOM", tx("Bottom", "下方")],
          ["LEFT", tx("Left", "左侧")],
          ["RIGHT", tx("Right", "右侧")],
        ],
      )}</div><p class="muted">${tx("The recommended plan includes tapered front rows and aisles suited to this screen format. For a custom plan, separate seat blocks with commas, for example 3,4,3.", "推荐布局的前排座位较少，过道按厅型设置。自定义时请用逗号分隔各座区的座位数，例如 3,4,3。")}</p><div data-layout-preview></div>${formEnd(tx("Save new version", "保存新版本"))}</form>`,
    );
    const form = d.querySelector("form");
    const plan = fd => fd.get("layout_mode") === "recommended" ? recommended : makeLayout(fd);
    function preview() {
      try {
        const custom = form.elements.layout_mode.value === "custom";
        form.querySelector("[data-custom-layout]").hidden = !custom;
        form.querySelectorAll("[data-custom-layout] input, [data-custom-layout] select").forEach(el => { el.disabled = !custom; });
        d.querySelector("[data-layout-preview]").innerHTML = layoutMap(
          plan(new FormData(form)),
        );
      } catch (err) {
        d.querySelector("[data-layout-preview]").innerHTML =
          `<p class="error">${esc(errorText(err))}</p>`;
      }
    }
    form.addEventListener("input", preview);
    preview();
    formAction(form, async (fd) => {
      const { width, ...body } = plan(fd);
      const result = await request(
        `/staff/screens/${screenId}/layouts`,
        "POST",
        body,
      );
      d.close();
      toast(
        tx(`Layout v${result.version_no} created with ${result.seat_count} seats.`, `已创建布局 v${result.version_no}，共 ${result.seat_count} 个座位。`),
      );
      await reload();
    });
  }
  async function viewLayout(id) {
    const layout = await request(`/staff/layouts/${id}`);
    dialog(tx(`Layout v${layout.version_no} · Seat map`, `布局 v${layout.version_no} · 座位图`), layoutMap(layout));
  }

  async function bookings(page) {
    const result = await request(
      "/staff/bookings?" +
        new URLSearchParams({ page: String(page), q: bookingQuery }),
    );
    return () => panel(
      tx("Branch bookings", "本店订单"),
      `<form data-booking-search class="toolbar">${input(tx("Search bookings", "搜索订单"), "q", bookingQuery, "search", `placeholder="${tx("Full booking ID or film title", "完整订单编号或片名")}"`)}<button class="button secondary" type="submit">${tx("Search", "搜索")}</button><p class="error" data-error hidden></p></form><div data-booking-table>${bookingTable(result.items)}</div>` +
        pager(
          page,
          (result.total ?? Infinity) > page * (result.page_size || 20),
        ),
    );
  }
  function bookingTable(items) {
    return table(
      [
        tx("Booking", "订单"),
        tx("Film / screening", "影片 / 场次"),
        tx("Channel", "购票渠道"),
        tx("Status", "状态"),
        tx("Net ticket value / Cumulative fees", "实付票款 / 累计改签费"),
        tx("Actions", "操作"),
      ],
      items.map((b) => [
        `<strong>…${esc(short(b.id))}</strong>`,
        `${esc(filmTitle(b.film_title) || filmName(b.film_id))}<div class="muted">${dateTime(b.starts_at || b.screening_starts_at || b.created_at)}</div>`,
        status(b.channel),
        status(b.status),
        `${money(b.net_ticket_minor)}<div class="muted">${tx(`Fees ${money(b.cumulative_fee_minor)}`, `改签费 ${money(b.cumulative_fee_minor)}`)}</div>`,
        button(tx("Details", "详情"), "booking-detail", b.id),
      ]),
      tx("No branch bookings yet", "本店暂无订单"),
    );
  }
  async function bookingDialog(id) {
    const data = await request(`/ui/bookings/${id}`);
    const b = data.booking || data;
    dialog(
      tx("Booking details", "订单详情"),
      `<div class="stack"><p><strong>${esc(filmTitle(b.film_title) || filmName(b.film_id))}</strong><br><span class="muted">${tx(`Booking ${esc(b.id)}`, `订单 ${esc(b.id)}`)} · ${esc(statusText(b.channel))}</span></p><p>${esc(venueName(b.cinema_name) || cinemaName(b.cinema_id))} · ${esc(auditoriumName(b.screen_name) || "")}<br>${dateTime(b.starts_at)}</p><div>${status(b.status)}</div><div class="metric-grid"><div class="metric"><span>${tx("Net ticket value", "实付票款")}</span><strong>${money(b.net_ticket_minor)}</strong></div><div class="metric"><span>${tx("Change fee", "本次改签费")}</span><strong>${money(b.current_fee_minor)}</strong></div><div class="metric"><span>${tx("Cumulative fees", "累计改签费")}</span><strong>${money(b.cumulative_fee_minor)}</strong></div></div>${table(
        [tx("Seat", "座位"), tx("Fare type", "票种"), tx("Face value", "票面价格")],
        (data.tickets || b.tickets || []).map((t) => [
          t.row_no
            ? tx(`Row ${esc(t.row_no)}, seat ${esc(t.seat_no)}`, `${esc(t.row_no)} 排 ${esc(t.seat_no)} 座`)
            : tx(`Seat …${esc(short(t.seat_id))}`, `座位 …${esc(short(t.seat_id))}`),
          esc(statusText(t.fare_type)),
          money(t.face_price_minor),
        ]),
      )}<h3>${tx("Refund history", "退款记录")}</h3>${table(
        [tx("Refund amount", "退款金额"), tx("Status", "状态"), tx("Completed at", "完成时间")],
        (data.refunds || b.refunds || []).map((r) => [
          money(r.amount_minor),
          status(r.status),
          r.settled_at ? dateTime(r.settled_at) : tx("Awaiting processing", "待处理"),
        ]),
        tx("No refunds", "暂无退款"),
      )}<h3>${tx("Compensation coupons", "补偿券")}</h3>${table(
        [tx("Status", "状态"), tx("Discount", "优惠"), tx("Issued at", "发放时间")],
        (
          data.compensation_coupons ||
          data.coupons ||
          b.coupons ||
          (b.compensation_coupon ? [b.compensation_coupon] : [])
        ).map((c) => [
          c.status === "AVAILABLE" ? tx("Available", "可用") : tx("Used", "已使用"),
          tx("50% off at the same cinema", "本店五折优惠"),
          c.issued_at ? dateTime(c.issued_at) : tx("Issued", "已发放"),
        ]),
        tx("No compensation coupons", "暂无补偿券"),
      )}</div>`,
    );
  }
  async function refunds(page) {
    const result = await request(`/staff/refunds?page=${page}`);
    result.items.forEach((r) => refundRecords.set(String(r.id), r));
    return () => panel(
      tx("Refunds", "退款"),
      alertBox(
        tx("Refunds enter settlement totals only after completion. Retrying the same refund cannot credit it twice. Coupon issuance and refund completion are tracked separately.", "已完成的退款才计入结算。重试同一笔退款不会重复入账。优惠券发放与退款进度分别记录。"),
      ) +
        table(
          [tx("Booking / film", "订单 / 影片"), tx("Amount", "金额"), tx("Reason", "原因"), tx("Status", "状态"), tx("Actions", "操作")],
          result.items.map((r) => [
            `…${esc(short(r.booking_id))}<div class="muted">${esc(filmTitle(r.film_title) || "")}</div>`,
            money(r.amount_minor),
            r.reason === "CUSTOMER_CANCELLATION" ? tx("Customer ticket refund", "顾客退票") : r.reason === "CINEMA_CANCELLATION"
              ? tx("Cinema cancellation", "影院取消")
              : tx("Change difference", "改签差额"),
            status(r.status),
            r.status === "SUCCEEDED"
              ? dateTime(r.settled_at)
              : button(tx("Process refund", "处理退款"), "retry-refund", r.id),
          ]),
          tx("No refunds", "暂无退款"),
        ) +
        pager(
          page,
          (result.total ?? Infinity) > page * (result.page_size || 20),
        ),
    );
  }
  function retryRefund(id) {
    const r = refundRecords.get(String(id));
    if (!r) return;
    const d = dialog(
      tx("Confirm refund", "确认退款"),
      `<form class="stack"><p>${tx("Booking …", "订单 …")}${esc(short(r.booking_id))}${r.customer_name ? ` · ${esc(r.customer_name)}` : ""}</p><div class="metric"><span>${tx("Credit to customer balance", "退回顾客余额")}</span><strong>${money(r.amount_minor)}</strong></div><p>${tx("This refund will be credited to the customer’s balance. A completed refund cannot be paid twice.", "退款将退回到顾客余额。已完成的退款不会重复入账。")}</p>${formEnd(tx("Confirm refund", "确认退款"))}</form>`,
    );
    formAction(d.querySelector("form"), async () => {
      await request(`/staff/refunds/${id}/retry`, "POST", {});
      d.close();
      toast(tx("Refund completed.", "退款已完成。"));
      await reload();
    });
  }

  async function cinemaPanel() {
    await fetchAdmin();
    return () => (
      panel(
        tx("Cinema locations", "影院门店"),
        table(
          [
            tx("Cinema / brand", "影院 / 品牌"),
            tx("District / address", "行政区 / 地址"),
            tx("Status", "状态"),
            tx("Manager", "经理"),
            tx("Actions", "操作"),
          ],
          cinemas.map((c) => [
            `<strong>${esc(venueName(c.name))}</strong><div class="muted">${esc(venueBrand(c.brand))}</div>`,
            `${esc(districtName(c.district_id))}<div class="muted">${esc(venueAddress(c.name, c.address))}</div>`,
            `<span class="badge">${c.is_active ? tx("Active", "已启用") : tx("Manager required", "待指定经理")}</span>`,
            esc(
              staff.find((s) => String(s.id) === String(c.manager_user_id))
                ?.display_name || tx("Not assigned", "未指派"),
            ),
            `${button(tx("Edit", "编辑"), "edit-cinema", c.id)} ${button(tx("Assign manager", "指定经理"), "manager", c.id, "ghost")}`,
          ]),
          tx("No cinemas yet", "暂无影院"),
        ),
        button(tx("＋ Add cinema", "＋ 添加影院"), "create-cinema", "", ""),
      ) +
      panel(
        tx("Beijing districts", "北京行政区"),
        table(
          [tx("District", "行政区"), tx("Code", "行政区划代码"), tx("Actions", "操作")],
          districts.map((d) => [
            esc(districtLabel(d)),
            esc(d.admin_code),
            button(tx("Edit", "编辑"), "edit-district", d.id),
          ]),
        ),
        button(tx("＋ Add district", "＋ 添加行政区"), "create-district", "", "secondary"),
      )
    );
  }
  function cinemaDialog(id) {
    const c = cinemas.find((c) => String(c.id) === String(id)) || {};
    const d = dialog(
      id ? tx("Edit cinema", "编辑影院") : tx("Add cinema", "添加影院"),
      `<form class="stack"><div class="form-grid">${input(tx("Cinema name", "影院名称"), "name", c.name, "text", 'required maxlength="120"')}${input(tx("Brand", "品牌"), "brand", c.brand, "text", 'required maxlength="80"')}${select(
        tx("District", "行政区"),
        "district_id",
        districts.map((v) => [v.id, districtLabel(v)]),
        c.district_id,
        "required",
      )}</div>${input(tx("Street address", "详细地址"), "address", c.address, "text", 'required maxlength="255"')}${id ? `<details><summary>${tx("Map coordinates (optional)", "地图坐标（选填）")}</summary><p class="muted">${tx("Enter both GCJ-02 coordinates, or leave both blank. The cinema address remains available.", "请同时填写 GCJ-02 经纬度，或全部留空。未填写坐标时仍会显示影院地址。")}</p><div class="form-grid">${input(tx("Latitude", "纬度"), "latitude", c.latitude, "number", 'step="any" min="-90" max="90"')}${input(tx("Longitude", "经度"), "longitude", c.longitude, "number", 'step="any" min="-180" max="180"')}</div></details>` : alertBox(tx("The new cinema becomes active after a staff member is assigned as its manager.", "从本店员工中指定一位经理后，新影院即可启用。"))}${formEnd(tx("Save cinema", "保存影院"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      const body = {
        name: fd.get("name"),
        brand: fd.get("brand"),
        district_id: fd.get("district_id"),
        address: fd.get("address"),
      };
      if (id) {
        const lat = fd.get("latitude"),
          lon = fd.get("longitude");
        if (Boolean(lat) !== Boolean(lon))
          throw new LocalizedError("Enter both latitude and longitude, or leave both blank.", "经纬度需同时填写或同时留空。");
        body.latitude = lat ? Number(lat) : null;
        body.longitude = lon ? Number(lon) : null;
        if (lat) body.coordinate_system = "GCJ02";
      }
      await request(
        id ? `/admin/cinemas/${id}` : "/admin/cinemas",
        id ? "PUT" : "POST",
        body,
      );
      d.close();
      toast(tx("Cinema details saved.", "影院信息已保存。"));
      await reload();
    });
  }
  function districtDialog(id) {
    const item = districts.find((d) => String(d.id) === String(id)) || {};
    const d = dialog(
      id ? tx("Edit district", "编辑行政区") : tx("Add district", "添加行政区"),
      `<form class="stack">${input(tx("District name", "行政区名称"), "name", item.name, "text", 'required maxlength="80"')}${input(tx("Six-digit administrative code", "六位行政区划代码"), "admin_code", item.admin_code, "text", `required pattern="1101[0-9]{2}" maxlength="6" placeholder="${tx("For example: 110105", "例如：110105")}"`)}${formEnd(tx("Save district", "保存行政区"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(
        id ? `/admin/districts/${id}` : "/admin/districts",
        id ? "PUT" : "POST",
        Object.fromEntries(fd),
      );
      districts = rowsOf(await request("/districts"));
      d.close();
      toast(tx("District saved.", "行政区已保存。"));
      await reload();
    });
  }
  function managerDialog(id) {
    const employees = staff.filter(
      (s) => String(s.staff_cinema_id) === String(id),
    );
    if (!employees.length) {
      toast(
        tx("Create a staff account for this cinema before assigning its manager.", "请先为这家影院创建员工账号，再指定经理。"),
        "error",
      );
      return;
    }
    const c = cinemas.find((c) => String(c.id) === String(id));
    const d = dialog(
      tx(`Assign manager · ${venueName(c.name)}`, `指定经理 · ${venueName(c.name)}`),
      `<form class="stack">${select(
        tx("Cinema employee", "影院员工"),
        "staff_id",
        employees.map((e) => [
          e.id,
          `${e.display_name} · ${e.email_normalized}`,
        ]),
        c.manager_user_id,
        "required",
      )}${alertBox(tx("An active cinema has one manager. Saving replaces the current manager and activates the cinema. The manager can view this branch’s turnover.", "每家启用的影院设一位经理。保存后，新经理将接任并可查看本店营业额，影院也将启用。"))}${formEnd(tx("Confirm manager", "确认指派"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(`/admin/cinemas/${id}/manager`, "PUT", {
        staff_id: fd.get("staff_id"),
      });
      d.close();
      toast(tx("Manager assigned and cinema activated.", "已指定经理，影院已启用。"));
      await reload();
    });
  }

  async function filmPanel(page) {
    const result = await request(`/admin/films?page=${page}&page_size=20`);
    return () => (
      panel(
        tx("Shared film catalogue", "平台片库"),
        table(
          [tx("Film", "影片"), tx("Runtime", "片长"), tx("Status", "状态"), tx("Actions", "操作")],
          result.items.map((f) => [
            `<strong>${esc(filmTitle(f))}</strong>`,
            tx(`${esc(f.duration_minutes)} min`, `${esc(f.duration_minutes)} 分钟`),
            `<span class="badge">${f.archived ? tx("Archived", "已归档") : tx("Available", "已上架")}</span>`,
            button(tx("Edit", "编辑"), "edit-film", f.id),
          ]),
          tx("No films yet", "暂无影片"),
        ) + pager(page, result.total > page * result.page_size),
        button(tx("＋ Add film", "＋ 添加影片"), "create-film", "", ""),
      ) +
      panel(
        tx("Genres", "影片类型"),
        table(
          [tx("Type", "类型"), tx("Actions", "操作")],
          genres.map((g) => [esc(genreName(g)), button(tx("Edit", "编辑"), "edit-genre", g.id)]),
        ),
        button(tx("＋ Add genre", "＋ 添加类型"), "create-genre"),
      )
    );
  }
  async function filmDialog(id) {
    const f = id ? await request(`/films/${id}`) : {};
    const selected = (f.genres || []).map((g) => String(g.id));
    const d = dialog(
      id ? tx("Edit film", "编辑影片") : tx("Add film", "添加影片"),
      `<form class="stack"><div class="form-grid">${input(tx("Film title", "片名"), "title", f.title, "text", 'required maxlength="200"')}${input(tx("Runtime (minutes)", "片长（分钟）"), "duration_minutes", f.duration_minutes || 120, "number", 'required min="1" max="1000"')}</div>${textarea(tx("Synopsis", "剧情简介"), "synopsis", f.synopsis || "", 'maxlength="6000"')}<fieldset><legend>${tx("Genres", "影片类型")}</legend><div class="actions">${genres.map((g) => `<label><input type="checkbox" name="genre_ids" value="${esc(g.id)}" ${selected.includes(String(g.id)) ? "checked" : ""}> ${esc(genreName(g))}</label>`).join("")}</div></fieldset><label><input type="checkbox" name="archived" ${f.archived ? "checked" : ""}> ${tx("Archive (stop ticket sales and new screenings)", "归档（停止售票和新增排片）")}</label>${alertBox(tx("Changing the runtime affects future screenings only. Published screenings and issued tickets retain their original details.", "片长修改仅适用于新排场次。已发布的场次和已出票的订单保留原信息。"))}${formEnd(tx("Save film", "保存影片"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(
        id ? `/admin/films/${id}` : "/admin/films",
        id ? "PUT" : "POST",
        {
          title: fd.get("title"),
          synopsis: fd.get("synopsis"),
          duration_minutes: Number(fd.get("duration_minutes")),
          genre_ids: fd.getAll("genre_ids"),
          archived: fd.has("archived"),
        },
      );
      films = rowsOf(await request("/films?page_size=100"));
      d.close();
      toast(tx("Film details saved.", "影片信息已保存。"));
      await reload();
    });
  }
  function genreDialog(id) {
    const g = genres.find((g) => String(g.id) === String(id)) || {};
    const d = dialog(
      id ? tx("Edit genre", "编辑影片类型") : tx("Add genre", "添加影片类型"),
      `<form class="stack">${input(tx("Genre name", "类型名称"), "name", g.name, "text", 'required maxlength="60"')}${formEnd(tx("Save genre", "保存类型"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(
        id ? `/admin/genres/${id}` : "/admin/genres",
        id ? "PUT" : "POST",
        Object.fromEntries(fd),
      );
      genres = rowsOf(await request("/genres"));
      d.close();
      toast(tx("Genre saved.", "影片类型已保存。"));
      await reload();
    });
  }

  async function staffPanel() {
    await fetchAdmin();
    const rosters = new Map(cinemas.map(c => [String(c.id), []]));
    for (const person of staff) {
      rosters.get(String(person.staff_cinema_id))?.push(person);
    }
    if (!rosters.has(staffCinemaFilter)) staffCinemaFilter = "";
    return () => {
      const collator = new Intl.Collator(getLanguage(), { numeric: true });
      const branches = [...cinemas].sort((a, b) => collator.compare(venueName(a.name), venueName(b.name)));
      const filter = select(tx("Filter by cinema", "按影院筛选"), "staff_cinema_filter",
        [["", tx("All cinemas", "全部影院")], ...branches.map(c => [c.id, venueName(c.name)])], staffCinemaFilter);
      const sections = branches.map(cinema => {
        const id = String(cinema.id);
        const members = rosters.get(id);
        const isManager = person => String(person.id) === String(cinema.manager_user_id);
        members.sort((a, b) => Number(isManager(b)) - Number(isManager(a))
          || collator.compare(a.display_name, b.display_name) || collator.compare(a.email_normalized, b.email_normalized));
        const roster = members.length ? table(
          [tx("Name / email", "姓名 / 邮箱"), tx("Role", "职务"), tx("Actions", "操作")],
          members.map(person => [
            `<strong>${esc(person.display_name)}</strong><div class="muted">${esc(person.email_normalized)}</div>`,
            isManager(person) ? `<span class="badge">${tx("Manager", "经理")}</span>` : tx("Staff", "员工"),
            button(tx("Transfer", "调店"), "transfer", person.id),
          ]),
        ) : `<p class="muted">${tx("No staff assigned to this cinema.", "这家影院暂无员工。")}</p>`;
        return `<section class="staff-roster" data-staff-cinema="${esc(id)}" aria-labelledby="staff-cinema-${esc(id)}"
          ${staffCinemaFilter && staffCinemaFilter !== id ? "hidden" : ""}>
          <header><h3 id="staff-cinema-${esc(id)}">${esc(venueName(cinema.name))}</h3>
          <span class="muted">${tx(`${members.length} staff`, `共 ${members.length} 人`)}</span></header>${roster}</section>`;
      });
      return panel(tx("Staff & managers", "员工与经理"),
        branches.length ? `<div class="toolbar">${filter}</div>${sections.join("")}` : tx("No cinemas yet", "暂无影院"),
        button(tx("＋ Create staff", "＋ 创建员工账号"), "create-staff", "", ""));
    };
  }
  function staffDialog() {
    if (!cinemas.length) {
      toast(tx("Create a cinema first.", "请先添加影院。"), "error");
      return;
    }
    const d = dialog(
      tx("Create staff account", "创建员工账号"),
      `<form class="stack">${input(tx("Name", "姓名"), "display_name", "", "text", 'required maxlength="80"')}${input(tx("Email", "邮箱"), "email", "", "email", 'required autocomplete="off"')}${input(tx("Initial password", "初始密码"), "password", "", "password", 'required minlength="10" maxlength="128" autocomplete="new-password"')}${select(
        tx("Assigned cinema", "所属影院"),
        "cinema_id",
        cinemas.map((c) => [c.id, venueName(c.name)]),
        staffCinemaFilter,
        "required",
      )}${formEnd(tx("Create staff", "创建员工账号"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request("/admin/staff", "POST", Object.fromEntries(fd));
      d.close();
      toast(tx("Staff account created.", "员工账号已创建。"));
      await reload();
    });
  }
  function transferDialog(id) {
    const s = staff.find((s) => String(s.id) === String(id));
    const old = cinemas.find((c) => String(c.id) === String(s.staff_cinema_id));
    const isManager = String(old?.manager_user_id) === String(id);
    const targets = cinemas.filter(
      (c) => String(c.id) !== String(s.staff_cinema_id),
    );
    if (!targets.length) {
      toast(tx("Create another cinema before transferring staff.", "请先添加另一家影院，再调动员工。"), "error");
      return;
    }
    const replacements = staff.filter(
      (e) =>
        String(e.staff_cinema_id) === String(s.staff_cinema_id) &&
        String(e.id) !== String(id),
    );
    const d = dialog(
      tx(`Transfer staff · ${s.display_name}`, `员工调店 · ${s.display_name}`),
      `<form class="stack"><p>${tx("Current cinema:", "当前影院：")} ${esc(venueName(old?.name) || "")}</p>${select(
        tx("Destination cinema", "调入影院"),
        "cinema_id",
        targets.map((c) => [c.id, venueName(c.name)]),
        "",
        "required",
      )}${isManager ? select(tx("Replacement manager at original cinema", "原门店接任经理"), "replacement_manager_id", [["", tx("Choose a replacement", "选择接任者")], ...replacements.map((e) => [e.id, e.display_name])], "", "required") : ""}${isManager ? alertBox(tx("This employee is the current manager. Choose another employee from the original cinema to take over.", "该员工是现任经理，请从原门店选择另一位员工接任。")) : ""}${formEnd(tx("Confirm transfer", "确认调店"))}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(`/admin/staff/${id}/cinema`, "PUT", Object.fromEntries(fd));
      d.close();
      toast(tx("Staff assignment updated.", "员工所属影院已更新。"));
      await reload();
    });
  }

  async function moderationPanel(page) {
    const result = await request(`/community/moderation/posts?page=${page}`);
    return () => panel(tx("Discussions & replies", "讨论与回复"), table(
      [tx("Film / discussion", "影片 / 讨论"), tx("Author", "作者"), tx("Content", "内容"), tx("Actions", "操作")],
      result.items.map(post => {
        const thread = post.kind === "thread";
        return [
          `<strong>${esc(filmTitle(post.film_title))}</strong><div>${esc(post.thread_title)}</div>`,
          `${esc(post.display_name)}<div class="muted">${dateTime(post.created_at)}</div>`,
          `<details><summary>${thread ? tx("Read discussion", "查看讨论") : tx("Read reply", "查看回复")}</summary><p class="community-text">${esc(post.body)}</p></details>`,
          button(thread ? tx("Remove discussion", "删除讨论") : tx("Remove reply", "删除回复"),
            thread ? "remove-thread" : "remove-reply", post.id, "ghost danger"),
        ];
      }),
      tx("No discussions or replies", "暂无讨论或回复"),
    ) + pager(page, result.has_next));
  }

  function turnoverPanel() {
    const now = beijingNow();
    const start = now.slice(0, 7) + "-01T00:00";
    const tomorrow =
      new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10) +
      "T00:00";
    return (
      panel(
        tx("Turnover & settlement", "营业额与结算"),
        `<form data-turnover class="stack"><div class="form-grid">${
          admin
            ? select(
                tx("Cinema", "影院"),
                "cinema_id",
                cinemas.map((c) => [c.id, venueName(c.name)]),
                "",
                "required",
              )
            : `<input type="hidden" name="cinema_id" value="${esc(user.staff_cinema_id)}">`
        }${input(tx("From (inclusive, Beijing time)", "起始时间（含，北京时间）"), "from", start, "datetime-local", "required")}${input(tx("To (exclusive, Beijing time)", "截止时间（不含，北京时间）"), "to", tomorrow, "datetime-local", "required")}</div>${formEnd(tx("View turnover", "查询营业额"))}</form><div data-turnover-result class="stack"></div>`,
      ) +
      alertBox(
        tx("Totals use successful settlement times. Ticket and fee amounts are separate; changes contribute only the ticket difference and new fee. Registration credits are excluded. Pending refunds show the current amount, not a historical snapshot.", "按结算成功时间统计，票款和手续费分别计算。改签仅计入票款差额及新增手续费，注册赠金不计入。待退款显示当前金额。"),
      )
    );
  }
  function bindTurnover() {
    formAction(content.querySelector("[data-turnover]"), async (fd) => {
      const from = zoned(fd.get("from")),
        to = zoned(fd.get("to"));
      if (from >= to)
        throw new LocalizedError("The end time must be after the start time.", "截止时间必须晚于起始时间。");
      const params = new URLSearchParams({ from, to });
      const t = await request(
        `/cinemas/${fd.get("cinema_id")}/turnover?${params}`,
      );
      showResult("[data-turnover-result]", () => {
        const metrics = [
          [tx("Net settlement", "结算净额"), t.net_settled_minor],
          [tx("Net ticket amount", "票款净额"), t.ticket_minor],
          [tx("Net fees", "手续费净额"), t.fee_minor],
          [tx("Successful payments", "已收款金额"), t.payments_minor],
          [tx("Successful refunds", "已退款金额"), t.refunds_minor],
          [tx("Pending refunds now", "当前待退款金额"), t.pending_refunds_now_minor],
        ];
        return `<p class="muted">${esc(cinemaName(t.cinema_id))} · ${dateTime(t.from)} — ${dateTime(t.to)} ${tx("(end exclusive)", "（不含截止时间）")}</p><div class="metric-grid">${metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${money(value)}</strong></div>`).join("")}</div><p class="muted">${tx("As of:", "统计时间：")} ${dateTime(t.as_of)} · ${tx("Net settlement = payments − refunds", "结算净额 = 收款 − 退款")}</p>`;
      });
    });
  }
  function bindCurrent(tab, page) {
    bindActions(content, async (action, id, target) => {
      if (target.disabled) return;
      target.disabled = true;
      try {
        if (action === "previous") await showTab(tab, page - 1);
        else if (action === "next") await showTab(tab, page + 1);
        else if (action === "reload") await reload();
        else if (action === "publish") await publishDialog();
        else if (action === "fares") await fareDialog(id);
        else if (action === "cancel") await cancelDialog(id);
        else if (action === "create-screen") screenDialog();
        else if (action === "create-layout") await layoutDialog(id);
        else if (action === "view-layout") await viewLayout(id);
        else if (action === "booking-detail") await bookingDialog(id);
        else if (action === "retry-refund") retryRefund(id);
        else if (action === "create-cinema") cinemaDialog();
        else if (action === "edit-cinema") cinemaDialog(id);
        else if (action === "manager") managerDialog(id);
        else if (action === "create-district") districtDialog();
        else if (action === "edit-district") districtDialog(id);
        else if (action === "create-film") await filmDialog();
        else if (action === "edit-film") await filmDialog(id);
        else if (action === "create-genre") genreDialog();
        else if (action === "edit-genre") genreDialog(id);
        else if (action === "create-staff") staffDialog();
        else if (action === "transfer") transferDialog(id);
        else if (action === "remove-thread" || action === "remove-reply") {
          const thread = action === "remove-thread";
          const prompt = thread
            ? tx("Remove this discussion and hide all its replies?", "删除这条讨论并隐藏其全部回复？")
            : tx("Remove this reply?", "删除这条回复？");
          if (!window.confirm(prompt)) return;
          const version = revision;
          await request(`/community/${thread ? "threads" : "replies"}/${id}`, "DELETE");
          if (alive && revision === version) {
            toast(thread ? tx("Discussion removed.", "讨论已删除。") : tx("Reply removed.", "回复已删除。"));
            await showTab(tab, page);
          }
        }
      } catch (err) {
        toast(errorText(err), "error");
      } finally {
        target.disabled = false;
      }
    });
    if (tab === "turnover") bindTurnover();
    if (tab === "staff") {
      content.querySelector('[name="staff_cinema_filter"]')?.addEventListener("change", event => {
        staffCinemaFilter = event.target.value;
        for (const section of content.querySelectorAll("[data-staff-cinema]")) {
          section.hidden = Boolean(staffCinemaFilter && section.dataset.staffCinema !== staffCinemaFilter);
        }
      });
    }
    if (tab === "bookings")
      formAction(content.querySelector("[data-booking-search]"), async (fd) => {
        bookingQuery = String(fd.get("q")).trim();
        await showTab("bookings", 1);
      });
  }
  const requestedTab = new URLSearchParams(
    location.hash.split("?")[1] || "",
  ).get("tab");
  if (tabs().some(([id]) => id === requestedTab)) currentTab = requestedTab;
  await showTab(currentTab);
  root.querySelector("[data-workspace-heading]").innerHTML = heading();
  return () => {
    alive = false;
    disposePanel?.();
    revision++;
    dialogs.forEach((d) => d.close());
    root.classList.remove("operations-view");
  };
}

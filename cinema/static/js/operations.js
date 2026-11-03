import { esc, money, dateTime } from "./ui.js";

const statuses = {
  PUBLISHED: "On sale",
  CANCELLED: "Cancelled",
  CONFIRMED: "Confirmed",
  RESCHEDULED: "Rescheduled",
  CINEMA_CANCELLED: "Cinema cancellation",
  PENDING: "Pending refund",
  FAILED: "Needs retry",
  SUCCEEDED: "Completed",
  STANDARD: "Standard",
  STUDENT: "Student",
  IMAX: "IMAX",
  DOLBY_CINEMA: "Dolby Cinema",
  ONLINE: "Online",
  COUNTER: "Counter",
};
const status = (value) =>
  `<span class="badge status ${esc(value)}">${esc(statuses[value] || value)}</span>`;
const rowsOf = (value) => (Array.isArray(value) ? value : value?.items || []);
const input = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" value="${esc(value ?? "")}" ${extra}></label>`;
const textarea = (label, name, value = "", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><textarea name="${esc(name)}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
const select = (label, name, options, value = "", extra = "") =>
  `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}" aria-label="${esc(label)}" ${extra}>${options.map(([id, title]) => `<option value="${esc(id)}" ${String(id) === String(value) ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>`;
const button = (text, action, id = "", kind = "secondary") =>
  `<button type="button" class="button ${kind}" data-act="${action}" data-id="${esc(id)}">${text}</button>`;
const table = (head, rows, fallback = "No records yet") =>
  rows.length
    ? `<div class="table-wrap"><table class="table"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : `<div class="empty"><strong>${esc(fallback)}</strong><p class="muted">Records will appear here after the relevant activity.</p></div>`;
const alertBox = (text) => `<div class="notice">${esc(text)}</div>`;
const beijingNow = () =>
  new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
const zoned = (value) => {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value))
    throw new Error("Choose a valid date and time in Beijing time.");
  return `${value}:00+08:00`;
};
const fen = (value) => {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match)
    throw new Error("Enter a positive fare with at most two decimal places.");
  const amount =
    Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  if (amount <= 0 || amount > 10000000)
    throw new Error("Fares must be between ¥0.01 and ¥100,000.00.");
  return amount;
};
const yuan = (value) => (value == null ? "" : (Number(value) / 100).toFixed(2));
const short = (value) => String(value || "").slice(-8);

/** Branch and platform workspaces. All mutations use server role/scope enforcement. */
export async function renderOperations(ctx) {
  const { root, api, user, bootstrap, toast } = ctx;
  const admin = user.role === "PLATFORM_ADMIN";
  if (!admin && user.role !== "STAFF") {
    root.innerHTML = alertBox(
      "Sign in with a cinema staff or platform administrator account to use this workspace.",
    );
    return;
  }
  root.classList.add("operations-view");
  let alive = true,
    revision = 0,
    currentTab = admin ? "cinemas" : "programme",
    bookingQuery = "";
  const refundRecords = new Map();
  let cinemas = rowsOf(bootstrap.cinemas),
    districts = rowsOf(bootstrap.districts),
    genres = rowsOf(bootstrap.genres),
    films = rowsOf(bootstrap.films),
    screens = [],
    staff = [];
  const dialogs = new Set();
  const tabs = admin
    ? [
        ["cinemas", "Cinemas"],
        ["films", "Films & genres"],
        ["staff", "Staff & managers"],
        ["turnover", "Turnover"],
      ]
    : [
        ["programme", "Screenings & fares"],
        ["layouts", "Auditoriums & seats"],
        ["counter", "Counter sales"],
        ["bookings", "Branch bookings"],
        ["refunds", "Refunds"],
        ...(user.is_manager ? [["turnover", "Turnover"]] : []),
      ];
  const cinemaName = (id) =>
    cinemas.find((c) => String(c.id) === String(id))?.name || "Your cinema";
  const filmName = (id) =>
    films.find((f) => String(f.id) === String(id))?.title ||
    `Film ${short(id)}`;
  const screenName = (id) =>
    screens.find((s) => String(s.id) === String(id))?.name ||
    `Auditorium ${short(id)}`;
  const districtName = (id) =>
    districts.find((d) => String(d.id) === String(id))?.name || "Not set";
  root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${admin ? "PLATFORM CONSOLE" : "CINEMA WORKSPACE"}</p><h1>${admin ? "Platform management" : "Cinema workspace"}</h1><p class="muted">${admin ? "Manage the shared catalogue, cinemas and staff, and review branch settlements." : `${esc(cinemaName(user.staff_cinema_id))} · ${user.is_manager ? "Manager" : "Staff"} · All times are Beijing time`}</p></div></div><nav class="tabs" aria-label="Operations navigation">${tabs.map(([id, label]) => `<button class="tab ${id === currentTab ? "active" : ""}" data-tab="${id}" type="button">${label}</button>`).join("")}</nav><div class="operations-body stack" aria-live="polite"></div>`;
  const content = root.querySelector(".operations-body");
  const errorText = (err) =>
    err?.userMessage ||
    err?.message ||
    "The action could not be completed. Please try again.";
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
        submit.textContent = "Working…";
      }
      try {
        await callback(new FormData(form), form);
      } catch (err) {
        if (error) {
          error.hidden = false;
          error.textContent = errorText(err);
          error.focus();
        } else toast(errorText(err), "error");
      } finally {
        delete form.dataset.busy;
        if (submit) {
          submit.disabled = false;
          submit.textContent = old;
        }
      }
    });
  }
  function dialog(title, body) {
    const d = document.createElement("dialog");
    d.className = "modal-dialog operations-dialog";
    d.setAttribute("aria-label", title);
    d.innerHTML = `<div class="panel-header"><h2>${esc(title)}</h2><button type="button" class="button ghost" data-close aria-label="Close dialog">Close ×</button></div><div class="stack">${body}</div>`;
    document.body.append(d);
    dialogs.add(d);
    d.querySelector("[data-close]").onclick = () => d.close();
    d.addEventListener("close", () => {
      dialogs.delete(d);
      d.remove();
    });
    d.showModal();
    return d;
  }
  const formEnd = (label = "Save", kind = "") =>
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
  async function showTab(tab, page = 1) {
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
    content.innerHTML =
      '<div class="panel"><p class="muted">Loading…</p></div>';
    try {
      let markup;
      if (tab === "programme") markup = await programme(page);
      else if (tab === "layouts") markup = await layouts();
      else if (tab === "counter") markup = counter();
      else if (tab === "bookings") markup = await bookings(page);
      else if (tab === "refunds") markup = await refunds(page);
      else if (tab === "cinemas") markup = await cinemaPanel();
      else if (tab === "films") markup = await filmPanel(page);
      else if (tab === "staff") markup = await staffPanel();
      else if (tab === "turnover") {
        if (admin) await fetchAdmin();
        markup = turnoverPanel();
      }
      if (!alive || token !== revision) return;
      content.innerHTML = markup;
      bindCurrent(tab, page);
    } catch (err) {
      if (alive && token === revision) {
        content.innerHTML = `<div class="panel"><p class="error" role="alert">${esc(errorText(err))}</p>${button("Reload", "reload")}</div>`;
        bindActions(content, () => reload());
      }
    }
  }
  root
    .querySelector('[aria-label="Operations navigation"]')
    .addEventListener("click", (event) => {
      const b = event.target.closest("[data-tab]");
      if (b) showTab(b.dataset.tab);
    });
  const pager = (page, hasNext) =>
    `<div class="actions">${page > 1 ? button("Previous", "previous") : ""}<span class="muted">Page ${page}</span>${hasNext ? button("Next", "next") : ""}</div>`;
  const layoutOptions = () =>
    screens.flatMap((s) =>
      (s.layouts || []).map((l) => [
        l.id,
        `${s.name} · Layout v${l.version_no} · ${l.row_count} rows`,
      ]),
    );
  function programmeFields(s = {}) {
    return `<div class="form-grid">${select(
      "Film",
      "film_id",
      films.filter((f) => !f.archived).map((f) => [f.id, f.title]),
      s.film_id,
      "required",
    )}${select("Auditorium / layout version", "layout_id", layoutOptions(), s.layout_id, "required")}${input("Starts at (Beijing time)", "starts_at", s.starts_at?.slice(0, 16) || "", "datetime-local", "required")}${input("Standard fare (CNY)", "STANDARD", s.STANDARD || "65.00", "number", 'min="0.01" max="100000" step="0.01" required')}${input("Student fare (CNY)", "STUDENT", s.STUDENT || "40.00", "number", 'min="0.01" max="100000" step="0.01" required')}</div>`;
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
    return panel(
      "Screenings",
      alertBox(
        "Allow 15 minutes between screenings for turnaround. To change a published screening’s time, film or auditorium, use Cancel / replace.",
      ) +
        table(
          ["Film / auditorium", "Start / end", "Status", "Version", "Actions"],
          result.items.map((s) => [
            `<strong>${esc(s.film_title || filmName(s.film_id))}</strong><div class="muted">${esc(s.screen_name || screenName(s.screen_id))}</div>`,
            `${dateTime(s.starts_at)}<div class="muted">until ${dateTime(s.ends_at)}</div>`,
            status(s.status),
            `v${esc(s.revision_no)}`,
            s.status === "PUBLISHED" && new Date(s.starts_at) > new Date()
              ? `${button("Fares", "fares", s.id)} ${button("Cancel / replace", "cancel", s.id, "ghost")}`
              : '<span class="muted">Closed</span>',
          ]),
          "No screenings yet",
        ) +
        pager(page, result.items.length === 100),
      button("＋ Publish screening", "publish", "", ""),
    );
  }
  async function publishDialog() {
    if (!layoutOptions().length) {
      toast("Create an auditorium and a seating layout first.", "error");
      return;
    }
    const d = dialog(
      "Publish a screening",
      `<form class="stack">${programmeFields()}${alertBox("The auditorium is reserved for the film duration plus 15 minutes for turnaround. Fares apply to this screening only.")}${formEnd("Publish screening")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request("/staff/screenings", "POST", programmeBody(fd));
      d.close();
      toast("Screening published.");
      await reload();
    });
  }
  async function fareDialog(id) {
    const data = await request(`/screenings/${id}/seats`);
    const fares = Object.fromEntries(
      data.fares.map((f) => [f.fare_type, f.price_minor]),
    );
    const d = dialog(
      "Update screening fares",
      `<form class="stack"><p>${esc(filmName(data.screening.film_id))} · ${dateTime(data.screening.starts_at)}</p><div class="form-grid">${input("Standard fare (CNY)", "STANDARD", yuan(fares.STANDARD), "number", 'min="0.01" max="100000" step="0.01" required')}${input("Student fare (CNY)", "STUDENT", yuan(fares.STUDENT), "number", 'min="0.01" max="100000" step="0.01" required')}</div>${alertBox("Unpaid reservations will need a fresh quote. Prices on issued tickets remain unchanged.")}${formEnd("Save fares")}</form>`,
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
      toast("Fares updated.");
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
      "Cancel / replace screening",
      `<form class="stack"><p><strong>${esc(filmName(s.film_id))}</strong> · ${dateTime(s.starts_at)}</p>${textarea("Reason shown to customers", "reason", "", 'required maxlength="500"')}<label class="field"><span><input type="checkbox" name="with_replacement"> Publish a replacement screening</span></label><fieldset data-replacement hidden disabled><legend>Replacement screening</legend>${programmeFields({ ...s, ...fareValues })}</fieldset>${alertBox("Active bookings will be cancelled. Refunds cover current net tickets and all accumulated change fees, with one same-cinema 50% coupon per booking. Customers are not automatically moved to the replacement.")}${formEnd("Preview impact")}</form>`,
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
      "Confirm cancellation",
      `<form class="stack"><p><strong>${esc(filmName(s.film_id))}</strong><br>${esc(screenName(s.screen_id))} · ${dateTime(s.starts_at)}</p><p>${esc(p.reason)}</p><div class="metric-grid"><div class="metric"><span>Confirmed bookings</span><strong>${esc(p.booking_count)}</strong></div><div class="metric"><span>Refund total</span><strong>${money(p.refund_total_minor)}</strong></div><div class="metric"><span>Compensation coupons</span><strong>${esc(p.coupon_count)}</strong></div></div>${p.replacement ? alertBox(`Replacement: ${filmName(p.replacement.film_id)}, ${dateTime(p.replacement.starts_at)}.`) : ""}${table(
        ["Affected bookings", "Ticket value", "Cumulative fees"],
        (p.bookings || []).map((b) => [
          `…${esc(short(b.id))}`,
          money(b.net_ticket_minor),
          money(b.cumulative_fee_minor),
        ]),
        "No paid bookings",
      )}${alertBox("Cancellation takes effect immediately. Refunds and coupons are tracked separately; check Refunds for settlement status. A changed preview requires another review.")}${formEnd("Confirm cancellation & refunds", "danger")}</form>`,
    );
    formAction(d.querySelector("form"), async () => {
      const result = await api.action(
        `cancel-screening:${id}`,
        `/staff/screenings/${id}/cancel`,
        { preview_token: p.preview_token },
      );
      d.close();
      toast(
        `Screening cancelled; ${result.coupon_count} compensation coupons issued.`,
      );
      await reload();
    });
  }

  async function layouts() {
    await fetchScreens();
    return panel(
      "Auditoriums & layouts",
      alertBox(
        "Seat changes create a new layout version. Existing screenings keep their original layout. Scheduling checks use the physical auditorium across all versions.",
      ) +
        table(
          ["Auditorium", "Type", "Layout version", "Actions"],
          screens.map((s) => [
            `<strong>${esc(s.name)}</strong>`,
            status(s.screen_type),
            (s.layouts || [])
              .map(
                (l) =>
                  `<button type="button" class="button ghost" data-act="view-layout" data-id="${esc(l.id)}">v${esc(l.version_no)} · ${esc(l.row_count)} rows</button>`,
              )
              .join(" ") || '<span class="muted">Not created</span>',
            button("Create layout version", "create-layout", s.id),
          ]),
          "No auditoriums yet",
        ),
      button("＋ Add auditorium", "create-screen", "", ""),
    );
  }
  function screenDialog() {
    const d = dialog(
      "Add auditorium",
      `<form class="stack">${input("Auditorium name", "name", "", "text", 'required maxlength="80"')}${select(
        "Screen type",
        "screen_type",
        [
          ["STANDARD", "Standard auditorium"],
          ["IMAX", "IMAX"],
          ["DOLBY_CINEMA", "Dolby Cinema"],
        ],
      )}${formEnd("Add auditorium")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request("/staff/screens", "POST", Object.fromEntries(fd));
      d.close();
      toast("Auditorium added. Create its seating layout next.");
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
      throw new Error(
        "Use 1–100 rows and 1–100 seats per segment, with at most 8 segments.",
      );
    const width = segments.reduce((a, b) => a + b, 0) + segments.length - 1;
    if (rowCount * segments.reduce((a, b) => a + b, 0) > 5000)
      throw new Error("A layout can contain at most 5,000 seats.");
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
    const maxX = Math.max(...layout.seats.map((s) => s.map_x)) + 1;
    const maxY = Math.max(...layout.seats.map((s) => s.map_y)) + 1;
    return `<div class="notice">Screen position: ${{ TOP: "Top", BOTTOM: "Bottom", LEFT: "Left", RIGHT: "Right" }[layout.screen_direction]}. Row 1 is nearest the screen. ${layout.seats.length} seats.</div><div style="overflow:auto;padding:12px 0;max-height:340px"><div style="display:grid;grid-template-columns:repeat(${maxX},32px);grid-template-rows:repeat(${maxY},28px);gap:5px;width:max-content;margin:auto">${layout.seats.map((s) => `<span class="badge" title="Row ${s.row_no}, seat ${s.seat_no} · segment ${s.aisle_segment}" style="grid-column:${s.map_x + 1};grid-row:${s.map_y + 1};padding:3px;text-align:center;font-size:10px">${s.row_no}-${s.seat_no}</span>`).join("")}</div></div>`;
  }
  function layoutDialog(screenId) {
    const d = dialog(
      `${screenName(screenId)} · Create layout version`,
      `<form class="stack"><div class="form-grid">${input("Number of rows", "rows", "12", "number", 'min="1" max="100" required')}${input("Seats per aisle segment", "segments", "3,3", "text", 'required placeholder="For example: 3,4,3"')}${select(
        "Screen position",
        "direction",
        [
          ["TOP", "Top"],
          ["BOTTOM", "Bottom"],
          ["LEFT", "Left"],
          ["RIGHT", "Right"],
        ],
      )}</div><p class="muted">Separate aisle segments with commas. For example, 3,4,3 creates 10 seats and two aisles per row. Adjacent-seat suggestions stay within one segment.</p><div data-layout-preview></div>${formEnd("Save new version")}</form>`,
    );
    const form = d.querySelector("form");
    function preview() {
      try {
        d.querySelector("[data-layout-preview]").innerHTML = layoutMap(
          makeLayout(new FormData(form)),
        );
      } catch (err) {
        d.querySelector("[data-layout-preview]").innerHTML =
          `<p class="error">${esc(errorText(err))}</p>`;
      }
    }
    form.addEventListener("input", preview);
    preview();
    formAction(form, async (fd) => {
      const { width, ...body } = makeLayout(fd);
      const result = await request(
        `/staff/screens/${screenId}/layouts`,
        "POST",
        body,
      );
      d.close();
      toast(
        `Layout v${result.version_no} created with ${result.seat_count} seats.`,
      );
      await reload();
    });
  }
  async function viewLayout(id) {
    const layout = await request(`/staff/layouts/${id}`);
    dialog(`Layout v${layout.version_no} · Seat map`, layoutMap(layout));
  }

  function counter() {
    return (
      alertBox(
        "Customers approve counter service in their own account. Seat reservation and payment use separate approvals; staff cannot debit a wallet without payment consent.",
      ) +
      panel(
        "1 · Receive reservation approval",
        `<p class="muted">Ask the customer to choose counter service on the seat page and enter your staff ID: <strong>${esc(user.id)}</strong>. Paste their shared reservation approval below.</p><form data-counter-hold class="stack">${textarea("Reservation approval", "bundle", "", 'required placeholder="Paste the customer’s reservation approval"')}<details><summary>Enter token and request ID separately</summary>${input("Request ID (leave blank if included above)", "request_key", "", "text", 'autocomplete="off"')}</details>${formEnd("Verify & reserve seats")}</form><div data-hold-result></div>`,
      ) +
      panel(
        "2 · Receive payment approval",
        `<p class="muted">The customer selects fares and any coupon, reviews the amount, and shares payment approval. Verify the current quote before completing the sale.</p><form data-counter-payment class="stack">${textarea("Payment approval", "bundle", "", 'placeholder="Paste the customer’s payment approval"')}<details><summary>Enter quote and consent tokens separately</summary>${textarea("Quote token (leave blank if included above)", "quote_token", "")}${textarea("Consent token (leave blank if included above)", "consent_token", "")}</details>${formEnd("Review quote")}</form><div data-payment-result></div>`,
      )
    );
  }
  function parseBundle(value) {
    try {
      const data = JSON.parse(value);
      if (data && typeof data === "object") return data;
    } catch {}
    return {};
  }
  function bindCounter() {
    formAction(content.querySelector("[data-counter-hold]"), async (fd) => {
      const bundle = parseBundle(fd.get("bundle"));
      const token =
        bundle.hold_consent_token || String(fd.get("bundle")).trim();
      const key = bundle.request_key || String(fd.get("request_key")).trim();
      if (!key)
        throw new Error(
          "The reservation request ID is required. Paste the complete approval shared by the customer.",
        );
      const h = await api.request("/holds", {
        method: "POST",
        body: { hold_consent_token: token },
        requestKey: key,
      });
      content.querySelector("[data-hold-result]").innerHTML =
        `<div class="notice"><strong>Seats reserved</strong><p>Reservation ID: ${esc(h.hold_id)}<br>Valid until: ${dateTime(h.expires_at)}</p><p>Ask the customer to open their active reservation in My tickets, review the quote and approve payment. This reservation does not automatically renew.</p></div>`;
      toast("Seats reserved. Waiting for the customer’s quote approval.");
    });
    formAction(content.querySelector("[data-counter-payment]"), async (fd) => {
      const bundle = parseBundle(fd.get("bundle"));
      const quote_token =
        bundle.quote_token || String(fd.get("quote_token")).trim();
      const consent_token =
        bundle.consent_token || String(fd.get("consent_token")).trim();
      if (!quote_token || !consent_token)
        throw new Error(
          "Paste the complete payment approval, including the quote and consent tokens.",
        );
      const body = { quote_token, consent_token };
      const q = await request("/counter/preview", "POST", body);
      const d = dialog(
        "Review counter sale",
        `<form class="stack"><p><strong>${esc(q.film_title)}</strong><br>${esc(q.cinema_name)} · ${esc(q.screen_name)}<br>${dateTime(q.starts_at)}</p><div class="metric-grid"><div class="metric"><span>Net ticket value</span><strong>${money(q.net_ticket_minor)}</strong></div><div class="metric"><span>Change fee</span><strong>${money(q.current_fee_minor)}</strong></div><div class="metric"><span>${q.amount_due_minor < 0 ? "Refund to customer" : "Amount due"}</span><strong>${money(Math.abs(q.amount_due_minor))}</strong></div></div>${table(
          ["Seat", "Fare type", "Face value"],
          (q.tickets || []).map((t) => [
            esc(`Row ${t.row_no}, seat ${t.seat_no}`),
            esc(statuses[t.fare_type] || t.fare_type),
            money(t.face_price_minor),
          ]),
        )}<p>Seat count: ${q.tickets?.length || 0} · Valid until ${dateTime(q.expires_at)}</p>${q.source_booking_id ? `<p class="muted">Total change fees on this booking chain: ${money(q.cumulative_fee_minor)}</p>` : ""}${alertBox("The customer approved this quote. Confirm to complete the booking or change using their demo balance.")}${formEnd(q.source_booking_id ? "Confirm counter change" : "Confirm counter sale")}</form>`,
      );
      formAction(d.querySelector("form"), async () => {
        const receipt = await api.action("counter-purchase", "/bookings", body);
        d.close();
        content.querySelector("[data-payment-result]").innerHTML =
          `<div class="notice"><strong>Transaction completed</strong><p>Booking: ${esc(receipt.booking_id || receipt.result_booking_id)}</p>${button("View booking", "booking-detail", receipt.booking_id || receipt.result_booking_id)}</div>`;
        toast("Counter transaction completed.");
      });
    });
  }

  async function bookings(page) {
    const result = await request(
      "/staff/bookings?" +
        new URLSearchParams({ page: String(page), q: bookingQuery }),
    );
    return panel(
      "Branch bookings",
      `<form data-booking-search class="toolbar">${input("Search bookings", "q", bookingQuery, "search", 'placeholder="Full booking ID or film title"')}<button class="button secondary" type="submit">Search</button><p class="error" data-error hidden></p></form><div data-booking-table>${bookingTable(result.items)}</div>` +
        pager(
          page,
          (result.total ?? Infinity) > page * (result.page_size || 20),
        ),
    );
  }
  function bookingTable(items) {
    return table(
      [
        "Booking",
        "Film / screening",
        "Channel",
        "Status",
        "Net ticket value / Cumulative fees",
        "Actions",
      ],
      items.map((b) => [
        `<strong>…${esc(short(b.id))}</strong>`,
        `${esc(b.film_title || filmName(b.film_id))}<div class="muted">${dateTime(b.starts_at || b.screening_starts_at || b.created_at)}</div>`,
        status(b.channel),
        status(b.status),
        `${money(b.net_ticket_minor)}<div class="muted">Fees ${money(b.cumulative_fee_minor)}</div>`,
        button("Details", "booking-detail", b.id),
      ]),
      "No branch bookings yet",
    );
  }
  async function bookingDialog(id) {
    const data = await request(`/ui/bookings/${id}`);
    const b = data.booking || data;
    dialog(
      "Booking details",
      `<div class="stack"><p><strong>${esc(b.film_title || filmName(b.film_id))}</strong><br><span class="muted">Booking ${esc(b.id)} · ${statuses[b.channel] || ""}</span></p><p>${esc(b.cinema_name || cinemaName(b.cinema_id))} · ${esc(b.screen_name || "")}<br>${dateTime(b.starts_at)}</p><div>${status(b.status)}</div><div class="metric-grid"><div class="metric"><span>Net ticket value</span><strong>${money(b.net_ticket_minor)}</strong></div><div class="metric"><span>Change fee</span><strong>${money(b.current_fee_minor)}</strong></div><div class="metric"><span>Cumulative fees</span><strong>${money(b.cumulative_fee_minor)}</strong></div></div>${table(
        ["Seat", "Fare type", "Face value"],
        (data.tickets || b.tickets || []).map((t) => [
          t.row_no
            ? `Row ${esc(t.row_no)}, seat ${esc(t.seat_no)}`
            : `Seat …${esc(short(t.seat_id))}`,
          statuses[t.fare_type] || esc(t.fare_type),
          money(t.face_price_minor),
        ]),
      )}<h3>Refund history</h3>${table(
        ["Refund amount", "Status", "Completed at"],
        (data.refunds || b.refunds || []).map((r) => [
          money(r.amount_minor),
          status(r.status),
          r.settled_at ? dateTime(r.settled_at) : "Awaiting processing",
        ]),
        "No refunds",
      )}<h3>Compensation coupons</h3>${table(
        ["Status", "Discount", "Issued at"],
        (
          data.compensation_coupons ||
          data.coupons ||
          b.coupons ||
          (b.compensation_coupon ? [b.compensation_coupon] : [])
        ).map((c) => [
          c.status === "AVAILABLE" ? "Available" : "Used",
          "50% off at the same cinema",
          c.issued_at ? dateTime(c.issued_at) : "Issued",
        ]),
        "No compensation coupons",
      )}</div>`,
    );
  }
  async function refunds(page) {
    const result = await request(`/staff/refunds?page=${page}`);
    result.items.forEach((r) => refundRecords.set(String(r.id), r));
    return panel(
      "Refunds",
      alertBox(
        "Refunds enter settlement totals only after completion. Retrying the same refund cannot credit it twice. Coupon issuance and refund completion are tracked separately.",
      ) +
        table(
          ["Booking / film", "Amount", "Reason", "Status", "Actions"],
          result.items.map((r) => [
            `…${esc(short(r.booking_id))}<div class="muted">${esc(r.film_title || "")}</div>`,
            money(r.amount_minor),
            r.reason === "CINEMA_CANCELLATION"
              ? "Cinema cancellation"
              : "Change difference",
            status(r.status),
            r.status === "SUCCEEDED"
              ? dateTime(r.settled_at)
              : button("Process refund", "retry-refund", r.id),
          ]),
          "No refunds",
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
      "Confirm refund",
      `<form class="stack"><p>Booking …${esc(short(r.booking_id))}${r.customer_name ? ` · ${esc(r.customer_name)}` : ""}</p><div class="metric"><span>Credit to customer balance</span><strong>${money(r.amount_minor)}</strong></div><p>This refund will be credited to the customer’s balance. A completed refund cannot be paid twice.</p>${formEnd("Confirm refund")}</form>`,
    );
    formAction(d.querySelector("form"), async () => {
      await request(`/staff/refunds/${id}/retry`, "POST", {});
      d.close();
      toast("Refund completed.");
      await reload();
    });
  }

  async function cinemaPanel() {
    await fetchAdmin();
    return (
      panel(
        "Cinema locations",
        table(
          [
            "Cinema / brand",
            "District / address",
            "Status",
            "Manager",
            "Actions",
          ],
          cinemas.map((c) => [
            `<strong>${esc(c.name)}</strong><div class="muted">${esc(c.brand)}</div>`,
            `${esc(districtName(c.district_id))}<div class="muted">${esc(c.address)}</div>`,
            `<span class="badge">${c.is_active ? "Active" : "Manager required"}</span>`,
            esc(
              staff.find((s) => String(s.id) === String(c.manager_user_id))
                ?.display_name || "Not assigned",
            ),
            `${button("Edit", "edit-cinema", c.id)} ${button("Assign manager", "manager", c.id, "ghost")}`,
          ]),
          "No cinemas yet",
        ),
        button("＋ Add cinema", "create-cinema", "", ""),
      ) +
      panel(
        "Beijing districts",
        table(
          ["District", "Code", "Actions"],
          districts.map((d) => [
            esc(d.name),
            esc(d.admin_code),
            button("Edit", "edit-district", d.id),
          ]),
        ),
        button("＋ Add district", "create-district", "", "secondary"),
      )
    );
  }
  function cinemaDialog(id) {
    const c = cinemas.find((c) => String(c.id) === String(id)) || {};
    const d = dialog(
      id ? "Edit cinema" : "Add cinema",
      `<form class="stack"><div class="form-grid">${input("Cinema name", "name", c.name, "text", 'required maxlength="120"')}${input("Brand", "brand", c.brand, "text", 'required maxlength="80"')}${select(
        "District",
        "district_id",
        districts.map((v) => [v.id, v.name]),
        c.district_id,
        "required",
      )}</div>${input("Street address", "address", c.address, "text", 'required maxlength="255"')}${id ? `<details><summary>Map coordinates (optional)</summary><p class="muted">Enter both GCJ-02 coordinates, or leave both blank. The cinema address remains available.</p><div class="form-grid">${input("Latitude", "latitude", c.latitude, "number", 'step="any" min="-90" max="90"')}${input("Longitude", "longitude", c.longitude, "number", 'step="any" min="-180" max="180"')}</div></details>` : alertBox("The new cinema becomes active after a staff member is assigned as its manager.")}${formEnd("Save cinema")}</form>`,
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
          throw new Error(
            "Enter both latitude and longitude, or leave both blank.",
          );
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
      toast("Cinema details saved.");
      await reload();
    });
  }
  function districtDialog(id) {
    const item = districts.find((d) => String(d.id) === String(id)) || {};
    const d = dialog(
      id ? "Edit district" : "Add district",
      `<form class="stack">${input("District name", "name", item.name, "text", 'required maxlength="80"')}${input("Six-digit administrative code", "admin_code", item.admin_code, "text", 'required pattern="1101[0-9]{2}" maxlength="6" placeholder="For example: 110105"')}${formEnd("Save district")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(
        id ? `/admin/districts/${id}` : "/admin/districts",
        id ? "PUT" : "POST",
        Object.fromEntries(fd),
      );
      districts = rowsOf(await request("/districts"));
      d.close();
      toast("District saved.");
      await reload();
    });
  }
  function managerDialog(id) {
    const employees = staff.filter(
      (s) => String(s.staff_cinema_id) === String(id),
    );
    if (!employees.length) {
      toast(
        "Create a staff account for this cinema before assigning its manager.",
        "error",
      );
      return;
    }
    const c = cinemas.find((c) => String(c.id) === String(id));
    const d = dialog(
      `Assign manager · ${c.name}`,
      `<form class="stack">${select(
        "Cinema employee",
        "staff_id",
        employees.map((e) => [
          e.id,
          `${e.display_name} · ${e.email_normalized}`,
        ]),
        c.manager_user_id,
        "required",
      )}${alertBox("An active cinema has one manager. Saving replaces the current manager and activates the cinema. The manager can view this branch’s turnover.")}${formEnd("Confirm manager")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(`/admin/cinemas/${id}/manager`, "PUT", {
        staff_id: fd.get("staff_id"),
      });
      d.close();
      toast("Manager assigned and cinema activated.");
      await reload();
    });
  }

  async function filmPanel(page) {
    const result = await request(`/admin/films?page=${page}&page_size=20`);
    return (
      panel(
        "Shared film catalogue",
        table(
          ["Film", "Runtime", "Status", "Actions"],
          result.items.map((f) => [
            `<strong>${esc(f.title)}</strong>`,
            `${esc(f.duration_minutes)} min`,
            `<span class="badge">${f.archived ? "Archived" : "Available"}</span>`,
            button("Edit", "edit-film", f.id),
          ]),
          "No films yet",
        ) + pager(page, result.total > page * result.page_size),
        button("＋ Add film", "create-film", "", ""),
      ) +
      panel(
        "Genres",
        table(
          ["Type", "Actions"],
          genres.map((g) => [esc(g.name), button("Edit", "edit-genre", g.id)]),
        ),
        button("＋ Add genre", "create-genre"),
      )
    );
  }
  async function filmDialog(id) {
    const f = id ? await request(`/films/${id}`) : {};
    const selected = (f.genres || []).map((g) => String(g.id));
    const d = dialog(
      id ? "Edit film" : "Add film",
      `<form class="stack"><div class="form-grid">${input("Film title", "title", f.title, "text", 'required maxlength="200"')}${input("Runtime (minutes)", "duration_minutes", f.duration_minutes || 120, "number", 'required min="1" max="1000"')}</div>${textarea("Synopsis", "synopsis", f.synopsis || "", 'maxlength="6000"')}<fieldset><legend>Genres</legend><div class="actions">${genres.map((g) => `<label><input type="checkbox" name="genre_ids" value="${esc(g.id)}" ${selected.includes(String(g.id)) ? "checked" : ""}> ${esc(g.name)}</label>`).join("")}</div></fieldset><label><input type="checkbox" name="archived" ${f.archived ? "checked" : ""}> Archive (unavailable for new screenings)</label>${alertBox("Changing the runtime affects future screenings only. Published screenings and issued tickets retain their original details.")}${formEnd("Save film")}</form>`,
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
      toast("Film details saved.");
      await reload();
    });
  }
  function genreDialog(id) {
    const g = genres.find((g) => String(g.id) === String(id)) || {};
    const d = dialog(
      id ? "Edit genre" : "Add genre",
      `<form class="stack">${input("Genre name", "name", g.name, "text", 'required maxlength="60"')}${formEnd("Save genre")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(
        id ? `/admin/genres/${id}` : "/admin/genres",
        id ? "PUT" : "POST",
        Object.fromEntries(fd),
      );
      genres = rowsOf(await request("/genres"));
      d.close();
      toast("Genre saved.");
      await reload();
    });
  }

  async function staffPanel() {
    await fetchAdmin();
    return (
      panel(
        "Staff & managers",
        table(
          ["Name / email", "Assigned cinema", "Role", "Actions"],
          staff.map((s) => [
            `<strong>${esc(s.display_name)}</strong><div class="muted">${esc(s.email_normalized)}</div>`,
            esc(cinemaName(s.staff_cinema_id)),
            cinemas.some((c) => String(c.manager_user_id) === String(s.id))
              ? "Manager"
              : "Staff",
            button("Transfer", "transfer", s.id),
          ]),
          "No staff yet",
        ),
        button("＋ Create staff", "create-staff", "", ""),
      ) +
      alertBox(
        "Transferring a manager requires a replacement from the original cinema. The staff transfer and management handover complete together.",
      )
    );
  }
  function staffDialog() {
    if (!cinemas.length) {
      toast("Create a cinema first.", "error");
      return;
    }
    const d = dialog(
      "Create staff account",
      `<form class="stack">${input("Name", "display_name", "", "text", 'required maxlength="80"')}${input("Email", "email", "", "email", 'required autocomplete="off"')}${input("Initial password", "password", "", "password", 'required minlength="10" maxlength="128" autocomplete="new-password"')}${select(
        "Assigned cinema",
        "cinema_id",
        cinemas.map((c) => [c.id, c.name]),
        "",
        "required",
      )}${formEnd("Create staff")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request("/admin/staff", "POST", Object.fromEntries(fd));
      d.close();
      toast("Staff account created.");
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
      toast("Create another cinema before transferring staff.", "error");
      return;
    }
    const replacements = staff.filter(
      (e) =>
        String(e.staff_cinema_id) === String(s.staff_cinema_id) &&
        String(e.id) !== String(id),
    );
    const d = dialog(
      `Transfer staff · ${s.display_name}`,
      `<form class="stack"><p>Current cinema: ${esc(old?.name || "")}</p>${select(
        "Destination cinema",
        "cinema_id",
        targets.map((c) => [c.id, c.name]),
        "",
        "required",
      )}${isManager ? select("Replacement manager at original cinema", "replacement_manager_id", [["", "Choose a replacement"], ...replacements.map((e) => [e.id, e.display_name])], "", "required") : ""}${isManager ? alertBox("This employee is the current manager. Choose another employee from the original cinema to take over.") : ""}${formEnd("Confirm transfer")}</form>`,
    );
    formAction(d.querySelector("form"), async (fd) => {
      await request(`/admin/staff/${id}/cinema`, "PUT", Object.fromEntries(fd));
      d.close();
      toast("Staff assignment updated.");
      await reload();
    });
  }

  function turnoverPanel() {
    const now = beijingNow();
    const start = now.slice(0, 7) + "-01T00:00";
    const tomorrow =
      new Date(Date.now() + 8 * 3600000 + 86400000).toISOString().slice(0, 10) +
      "T00:00";
    return (
      panel(
        "Turnover & settlement",
        `<form data-turnover class="stack"><div class="form-grid">${
          admin
            ? select(
                "Cinema",
                "cinema_id",
                cinemas.map((c) => [c.id, c.name]),
                "",
                "required",
              )
            : `<input type="hidden" name="cinema_id" value="${esc(user.staff_cinema_id)}">`
        }${input("From (inclusive, Beijing time)", "from", start, "datetime-local", "required")}${input("To (exclusive, Beijing time)", "to", tomorrow, "datetime-local", "required")}</div>${formEnd("View turnover")}</form><div data-turnover-result class="stack"></div>`,
      ) +
      alertBox(
        "Totals use successful settlement times. Ticket and fee amounts are separate; changes contribute only the ticket difference and new fee. Registration credits are excluded. Pending refunds show the current amount, not a historical snapshot.",
      )
    );
  }
  function bindTurnover() {
    formAction(content.querySelector("[data-turnover]"), async (fd) => {
      const from = zoned(fd.get("from")),
        to = zoned(fd.get("to"));
      if (from >= to)
        throw new Error("The end time must be after the start time.");
      const params = new URLSearchParams({ from, to });
      const t = await request(
        `/cinemas/${fd.get("cinema_id")}/turnover?${params}`,
      );
      const metrics = [
        ["Net settlement", t.net_settled_minor],
        ["Net ticket amount", t.ticket_minor],
        ["Net fees", t.fee_minor],
        ["Successful payments", t.payments_minor],
        ["Successful refunds", t.refunds_minor],
        ["Pending refunds now", t.pending_refunds_now_minor],
      ];
      content.querySelector("[data-turnover-result]").innerHTML =
        `<p class="muted">${esc(cinemaName(t.cinema_id))} · ${dateTime(t.from)} — ${dateTime(t.to)} (end exclusive)</p><div class="metric-grid">${metrics.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${money(value)}</strong></div>`).join("")}</div><p class="muted">As of: ${dateTime(t.as_of)} · Net settlement = payments − refunds</p>`;
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
        else if (action === "create-layout") layoutDialog(id);
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
      } catch (err) {
        toast(errorText(err), "error");
      } finally {
        target.disabled = false;
      }
    });
    if (tab === "counter") bindCounter();
    if (tab === "turnover") bindTurnover();
    if (tab === "bookings")
      formAction(content.querySelector("[data-booking-search]"), async (fd) => {
        bookingQuery = String(fd.get("q")).trim();
        await showTab("bookings", 1);
      });
  }
  const requestedTab = new URLSearchParams(
    location.hash.split("?")[1] || "",
  ).get("tab");
  if (tabs.some(([id]) => id === requestedTab)) currentTab = requestedTab;
  await showTab(currentTab);
  return () => {
    alive = false;
    revision++;
    dialogs.forEach((d) => d.close());
    root.classList.remove("operations-view");
  };
}

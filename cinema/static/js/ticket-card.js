import { esc, money, dateTime, screenName, notice } from "./ui.js";
import { filmArtwork } from "./film-artwork.js";

// Original card copy; these are not quotations from the films.
const LINES = {
  "Interstellar": "Some journeys take you beyond the stars.",
  "Inception": "Leave the ordinary outside. Enter another dream.",
  "The Shawshank Redemption": "A little hope. A story that stays with you.",
  "Zootopia": "A big city. A bigger adventure.",
  "Spirited Away": "Step into a world you will never forget.",
  "Harry Potter and the Philosopher's Stone": "Your next stop: a little magic.",
  "Resident Evil (2026)": "When the lights go down, survival begins.",
  "Tenzing": "Every great journey begins with one brave step.",
  "The Love Hypothesis": "A little chemistry. A whole new story.",
  "牛来 (Niu Lai)": "Find a little wonder in the everyday.",
};
const STATES = {
  CONFIRMED: ["You're going to the movies", "Your seats are booked. Keep this ticket for your visit.", "CONFIRMED", "#315e4d"],
  STARTED: ["The screening has started", "This screening is in progress. Check with the cinema about late entry.", "IN PROGRESS", "#82541e"],
  ENDED: ["A night to remember", "This screening has ended. You can save the ticket as a keepsake.", "SCREENING ENDED", "#686776"],
  CUSTOMER_CANCELLED: ["These tickets were refunded", "These seats have been released. This ticket is no longer valid for admission.", "REFUNDED · NOT VALID", "#a13846"],
  CINEMA_CANCELLED: ["The cinema cancelled this screening", "This ticket is no longer valid. Check your order for refund details.", "CANCELLED · NOT VALID", "#a13846"],
  RESCHEDULED: ["Your plans have changed", "This ticket was replaced. Open your new booking in My tickets.", "REPLACED · NOT VALID", "#a13846"],
};
const stateFor = (data) => STATES[data.status] || ["Check your order", "Open your order for the latest ticket information.", "NOT VALID", "#a13846"];
const shortId = (id) => String(id).slice(-8);
const seatText = (seats) => seats.map(s => `Row ${s.row_no} · Seat ${s.seat_no}`).join(" / ");
const font = (size, weight = 400, serif = false) => `${weight} ${size}px ${serif ? 'Georgia, "Songti SC", serif' : 'Arial, "PingFang SC", sans-serif'}`;

function wrap(ctx, value, width) {
  const words = typeof Intl.Segmenter === "function"
    ? [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(String(value))].map(x => x.segment)
    : Array.from(String(value));
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && ctx.measureText(line + word).width > width) {
      lines.push(line.trim()); line = "";
    }
    if (ctx.measureText(word).width > width) {
      for (const char of word) {
        if (ctx.measureText(line + char).width > width) { lines.push(line.trim()); line = ""; }
        line += char;
      }
    } else line += word;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
function rounded(ctx, x, y, w, h, r, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
}
function text(ctx, value, x, y, size, color = "#262a3e", weight = 400, serif = false) {
  ctx.font = font(size, weight, serif); ctx.fillStyle = color; ctx.fillText(String(value), x, y);
}
function paragraph(ctx, value, x, y, width, size, color, weight = 400, lineHeight = size * 1.35, serif = false) {
  ctx.font = font(size, weight, serif);
  const lines = wrap(ctx, value, width);
  lines.forEach((line, i) => text(ctx, line, x, y + i * lineHeight, size, color, weight, serif));
  return lines.length * lineHeight;
}
function loadPoster(url) {
  return new Promise(resolve => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 5000);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = url;
  });
}
function cover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, x + (w - img.naturalWidth * scale) / 2, y + (h - img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.restore();
}

/** One native canvas is both the preview and the downloaded PNG. No remote render service. */
export async function renderTicketCanvas(data) {
  const image = await loadPoster(filmArtwork({ title: data.film_title }) || "/static/assets/journey-city.svg");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const seats = data.seats;
  ctx.font = font(35, 700);
  const cinemaHeight = wrap(ctx, data.cinema_name, 936).length * 46;
  ctx.font = font(25);
  const addressHeight = wrap(ctx, data.cinema_address, 936).length * 34;
  ctx.font = font(32, 700);
  const holderHeight = Math.max(44, wrap(ctx, data.holder_name, 600).length * 42);
  ctx.font = font(21, 700);
  const hallHeight = wrap(ctx, `${data.screen_name} · YOUR SEATS`, 936).length * 29;
  const seatHeight = Math.ceil(seats.length / 4) * 62;
  const detailHeight = 360 + cinemaHeight + addressHeight + holderHeight + hallHeight + seatHeight;
  const footerY = 772 + detailHeight;
  canvas.width = 1080; canvas.height = footerY + 360;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `${data.film_title}. ${data.cinema_name}. ${dateTime(data.starts_at)}. ${seatText(seats)}. ${stateFor(data)[2]}.`);
  ctx.textBaseline = "top";
  rounded(ctx, 0, 0, 1080, canvas.height, 36, "#fbf8f0");
  text(ctx, "falcons.", 64, 36, 52, "#ec255b", 900);
  text(ctx, "THE BIG SCREEN. YOUR STORY.", 545, 54, 19, "#77756e", 700);

  ctx.save(); ctx.beginPath(); ctx.roundRect(32, 120, 1016, 622, 20); ctx.clip();
  ctx.fillStyle = "#172735"; ctx.fillRect(32, 120, 1016, 622);
  if (image) { ctx.globalAlpha = .42; cover(ctx, image, 32, 120, 1016, 622); ctx.globalAlpha = 1; }
  const shade = ctx.createLinearGradient(32, 0, 1048, 0);
  shade.addColorStop(0, "rgba(13,24,34,.98)"); shade.addColorStop(.56, "rgba(13,24,34,.82)"); shade.addColorStop(1, "rgba(13,24,34,.22)");
  ctx.fillStyle = shade; ctx.fillRect(32, 120, 1016, 622);
  // Preserve the entire poster artwork, including its original title treatment.
  if (image) {
    const w = 338, h = 510, scale = Math.min(w / image.naturalWidth, h / image.naturalHeight);
    const iw = image.naturalWidth * scale, ih = image.naturalHeight * scale;
    ctx.save(); ctx.shadowColor = "#0008"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    ctx.drawImage(image, 662 + (w - iw) / 2, 168 + (h - ih) / 2, iw, ih); ctx.restore();
  }
  text(ctx, "A FALCONS MOVIE NIGHT", 72, 174, 20, "#dcc5a0", 700);
  let titleSize = 68;
  do { ctx.font = font(titleSize, 700, true); if (wrap(ctx, data.film_title, 542).length * titleSize * 1.12 <= 300) break; titleSize -= 2; } while (titleSize > 26);
  paragraph(ctx, data.film_title, 70, 238, 542, titleSize, "#fffaf0", 700, titleSize * 1.12, true);
  paragraph(ctx, LINES[data.film_title] || "Good stories deserve a big screen. This one's yours.", 72, 557, 510, 27, "#e0dcd3", 400, 38, true);
  text(ctx, `${screenName(data.screen_type)}   /   ${data.duration_minutes} MIN`, 72, 677, 22, "#dcc5a0", 700);
  ctx.restore();

  let y = 782;
  const start = new Date(data.starts_at);
  const fmt = (opts) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", ...opts }).format(start);
  text(ctx, "DATE", 72, y, 19, "#8b8375", 700);
  text(ctx, "SHOWTIME · BEIJING", 455, y, 19, "#8b8375", 700);
  text(ctx, "SCREEN", 785, y, 19, "#8b8375", 700);
  text(ctx, fmt({ day: "2-digit", month: "short", year: "numeric" }), 72, y + 36, 34, "#252b3d", 700);
  text(ctx, fmt({ hour: "2-digit", minute: "2-digit", hour12: false }), 455, y + 29, 48, "#252b3d", 700);
  text(ctx, screenName(data.screen_type), 785, y + 39, 27, "#252b3d", 700);
  y += 112;
  ctx.strokeStyle = "#e3ddd1"; ctx.beginPath(); ctx.moveTo(72, y); ctx.lineTo(1008, y); ctx.stroke();
  y += 32;
  text(ctx, "YOUR CINEMA", 72, y, 19, "#8b8375", 700); y += 34;
  y += paragraph(ctx, data.cinema_name, 72, y, 936, 35, "#252b3d", 700, 46);
  y += paragraph(ctx, data.cinema_address, 72, y + 8, 936, 25, "#77756e", 400, 34) + 28;
  text(ctx, "TICKET HOLDER", 72, y, 19, "#8b8375", 700);
  text(ctx, `${seats.length} ${seats.length === 1 ? "TICKET" : "TICKETS"} · TOTAL`, 785, y, 19, "#8b8375", 700);
  y += 32;
  paragraph(ctx, data.holder_name, 72, y, 600, 32, "#252b3d", 700, 42);
  text(ctx, money(data.net_ticket_minor), 785, y, 30, "#252b3d", 700);
  y += holderHeight + 24;
  // Hall names and row/seat values come from the actual booking, not the current layout.
  y += paragraph(ctx, `${data.screen_name} · YOUR SEATS`, 72, y, 936, 21, "#8b8375", 700, 29) + 16;
  seats.forEach((seat, i) => {
    const sx = 72 + (i % 4) * 237, sy = y + Math.floor(i / 4) * 62;
    rounded(ctx, sx, sy, 225, 50, 9, "#eee8dc");
    text(ctx, `R${seat.row_no}  /  S${seat.seat_no}`, sx + 18, sy + 12, 25, "#343748", 700);
  });

  // Perforated tear-off stub, with a quiet zone and integer-sized QR modules.
  ctx.strokeStyle = "#cfc5b3"; ctx.lineWidth = 2; ctx.setLineDash([8, 9]);
  ctx.beginPath(); ctx.moveTo(30, footerY); ctx.lineTo(1050, footerY); ctx.stroke(); ctx.setLineDash([]);
  ctx.save(); ctx.globalCompositeOperation = "destination-out";
  for (const x of [0, 1080]) { ctx.beginPath(); ctx.arc(x, footerY, 23, 0, Math.PI * 2); ctx.fill(); } ctx.restore();
  const state = stateFor(data);
  text(ctx, state[2], 72, footerY + 42, 23, state[3], 700);
  text(ctx, `NO. ${shortId(data.booking_id)}`, 72, footerY + 88, 40, "#252b3d", 700);
  text(ctx, "Scan to view ticket", 72, footerY + 155, 28, "#252b3d", 700);
  paragraph(ctx, "Sign in to see the latest booking status.", 72, footerY + 198, 590, 23, "#77756e", 400, 32);
  const n = data.qr_matrix.length, module = Math.floor(276 / (n + 8)), size = (n + 8) * module;
  const qx = 1008 - size, qy = footerY + 32;
  rounded(ctx, qx - 10, qy - 10, size + 20, size + 20, 12, "#fff");
  ctx.fillStyle = "#18212d";
  data.qr_matrix.forEach((row, ry) => row.forEach((bit, rx) => { if (bit) ctx.fillRect(qx + (rx + 4) * module, qy + (ry + 4) * module, module, module); }));
  text(ctx, "KEEP THE TICKET. KEEP THE MEMORY.", 72, footerY + 302, 18, "#8b8375", 700);
  return canvas;
}

function content(data) {
  const state = stateFor(data);
  return `<div class="ticket-card-stage"><div class="ticket-card-art" data-ticket-art></div></div>
    <section class="ticket-card-info"><p class="eyebrow">YOUR DIGITAL TICKET</p><h2 id="ticket-card-title">${esc(state[0])}</h2>
      <p class="ticket-card-message">${esc(state[1])}</p>
      <dl class="ticket-card-facts"><div><dt>Film</dt><dd>${esc(data.film_title)}</dd></div><div><dt>When</dt><dd>${esc(dateTime(data.starts_at))} · Beijing</dd></div><div><dt>Cinema</dt><dd>${esc(data.cinema_name)}<small>${esc(data.screen_name)} · ${esc(screenName(data.screen_type))}</small></dd></div><div><dt>Seats</dt><dd>${esc(seatText(data.seats))}</dd></div><div><dt>Ticket holder</dt><dd>${esc(data.holder_name)}</dd></div></dl>
      <button type="button" class="button wide" data-ticket-save><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg> Save ticket image</button>
      <button type="button" class="button ghost wide" data-ticket-refresh>Refresh ticket status</button>
      <p class="ticket-card-note">A high-resolution PNG, ready to keep on your phone.<br>The QR opens this ticket for you or cinema staff after sign-in.</p>
      <p class="ticket-card-result" role="status" data-ticket-result></p>
    </section>`;
}

/** Shared lifecycle for the order dialog and the signed QR destination. */
function mountTicket(host, api, endpoint) {
  const controller = new AbortController();
  let alive = true, canvas, ticket, loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    host.querySelectorAll("button").forEach(b => { b.disabled = true; });
    try {
      const data = await api.request(endpoint, { signal: controller.signal });
      const drawing = await renderTicketCanvas(data);
      if (!alive) return;
      ticket = data; canvas = drawing;
      host.innerHTML = content(data);
      host.querySelector("[data-ticket-art]").append(canvas);
    } catch (error) {
      if (!alive) return;
      host.innerHTML = `<div class="ticket-card-failure">${notice(error.userMessage || error.message, "error")}<button type="button" class="button secondary" data-ticket-refresh>Try again</button></div>`;
    } finally {
      loading = false;
      if (alive) host.querySelectorAll("button").forEach(b => { b.disabled = false; });
    }
  }
  host.innerHTML = '<div class="ticket-card-loading" role="status"><span class="spinner"></span> Preparing your ticket…</div>';
  host.addEventListener("click", async event => {
    const save = event.target.closest("[data-ticket-save]");
    if (event.target.closest("[data-ticket-refresh]")) { await load(); return; }
    if (!save || loading || save.disabled) return;
    save.disabled = true; save.textContent = "Preparing image…";
    try {
      // A saved image is a snapshot; fetch again so a newly refunded ticket isn't exported as confirmed.
      await load();
      if (!alive || !host.querySelector("[data-ticket-save]")) return;
      host.querySelector("[data-ticket-save]").disabled = true;
      const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("Unable to create the image. Please try again.")), "image/png"));
      if (!alive) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `Falcons-ticket-${shortId(ticket.booking_id)}.png`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      host.querySelector("[data-ticket-result]").textContent = "Your PNG is ready. Check your browser's downloads.";
    } catch (error) {
      if (alive) host.querySelector("[data-ticket-result]")?.replaceChildren(document.createTextNode(error.message));
    } finally {
      if (alive) { const button = host.querySelector("[data-ticket-save]"); if (button) { button.disabled = false; button.textContent = "Save ticket image"; } }
    }
  }, { signal: controller.signal });
  void load();
  return () => { alive = false; controller.abort(); };
}

export function openTicketCard(api, bookingId, trigger) {
  const dialog = document.createElement("dialog");
  dialog.className = "ticket-card-dialog";
  dialog.setAttribute("aria-label", "Movie ticket preview");
  dialog.innerHTML = '<button type="button" class="ticket-card-close" aria-label="Close ticket preview">×</button><div class="ticket-card-layout" data-ticket-host></div>';
  document.body.append(dialog);
  const dispose = mountTicket(dialog.querySelector("[data-ticket-host]"), api, `/bookings/${encodeURIComponent(bookingId)}/ticket`);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; dispose(); dialog.close(); dialog.remove();
    if (trigger?.isConnected) trigger.focus();
  };
  dialog.querySelector(".ticket-card-close").onclick = close;
  dialog.addEventListener("cancel", e => { e.preventDefault(); close(); });
  dialog.addEventListener("click", e => { if (e.target === dialog) { const r = dialog.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });
  dialog.showModal(); dialog.querySelector(".ticket-card-close").focus();
  return close;
}

export function renderTicketPage(ctx, token) {
  ctx.title = "Your movie ticket";
  ctx.root.innerHTML = `<div class="ticket-card-page"><a class="button ghost" href="${ctx.user.role === "CUSTOMER" ? "#/account" : "#/operations"}">← ${ctx.user.role === "CUSTOMER" ? "My tickets" : "Cinema workspace"}</a><div class="ticket-card-layout" data-ticket-host></div></div>`;
  return mountTicket(ctx.root.querySelector("[data-ticket-host]"), ctx.api, `/tickets/${encodeURIComponent(token)}`);
}

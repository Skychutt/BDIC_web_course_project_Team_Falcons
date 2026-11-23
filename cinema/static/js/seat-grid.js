import { seatGeometry } from "./seat-map.js";
import { esc, screenName } from "./ui.js";
import { tx } from "./locale.js";

export const seatLabel = (s) => tx(
  `Row ${s.row_no} · Seat ${s.seat_no}`,
  `${s.row_no} 排 ${s.seat_no} 座`,
);
const zoneLabel = (zone) => ({
  FRONT: tx("front", "前排"),
  MIDDLE: tx("middle", "中排"),
  REAR: tx("rear", "后排"),
})[zone] || zone;

export function seatGrid(map, selection, canChoose) {
  const seats = map.seats;
  const geometry = seatGeometry(seats);
  const kind = map.screening.screen_type || "STANDARD";
  const direction = map.layout.screen_direction.toLowerCase();
  return `<div class="auditorium-meta"><strong>${tx(`${map.layout.row_count} rows · ${seats.length} seats`, `${map.layout.row_count} 排 · ${seats.length} 座`)}</strong><span>${kind === "DOLBY_CINEMA" ? tx("Recliner seating · extra legroom", "躺椅座位 · 宽敞腿部空间") : kind === "IMAX" ? tx("Wide auditorium · tiered seating", "宽幅影厅 · 阶梯座位") : tx("Classic auditorium · divided seating blocks", "常规影厅 · 分区座位")}</span></div><div class="seat-scroll auditorium-${kind.toLowerCase()}" tabindex="0" aria-label="${tx("Seat map, scroll horizontally to see all seats", "座位图，可横向滚动查看全部座位")}"><div class="auditorium"><div class="screen-line ${direction}">${tx("SCREEN", "银幕")} · ${esc(screenName(kind))}</div><div class="seat-grid" role="group" aria-label="${tx("Seats, rows numbered nearest to furthest from the screen", "座位按距离银幕从近到远排列")}" style="--seat-columns:20px ${geometry.columnTracks} 20px;--seat-rows:${geometry.rowTracks || "none"}">${geometry.labels.map(({y, label}) => `<span class="row-label" aria-hidden="true" style="grid-column:1;grid-row:${y + 1}">${label}</span><span class="row-label" aria-hidden="true" style="grid-column:${geometry.columns + 2};grid-row:${y + 1}">${label}</span>`).join("")}${seats
    .map((seat) => {
      const selected = selection.has(seat.id);
      const selectable =
        canChoose && (seat.state === "AVAILABLE" || seat.held_by_me);
      const stateLabel = selected
        ? tx("selected", "已选")
        : seat.held_by_me
          ? tx("held by you", "你已占座")
          : ({ AVAILABLE: tx("available", "可选"), HELD: tx("held", "已占座"), SOLD: tx("sold", "已售") })[seat.state];
      return `<button type="button" class="seat ${seat.state === "SOLD" ? "sold" : ""} ${seat.state === "HELD" && !selected ? "held" : ""}" style="grid-column:${seat.map_x + 2};grid-row:${seat.map_y + 1}" data-seat="${esc(seat.id)}" aria-label="${esc(seatLabel(seat))}, ${stateLabel}, ${zoneLabel(seat.zone)}${tx(" zone", "")}" aria-pressed="${selected}" title="${esc(seatLabel(seat))} · ${zoneLabel(seat.zone)}" ${selectable ? "" : "disabled"}>${seat.seat_no}</button>`;
    })
    .join("")}</div></div></div>`;
}

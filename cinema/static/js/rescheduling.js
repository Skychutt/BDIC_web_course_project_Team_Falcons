import { tx } from "./locale.js";
import { esc } from "./ui.js";

export function rescheduleDeadline(startsAt) {
  return Date.parse(startsAt) - 30 * 60 * 1000;
}

export function closedReschedule(bookingId) {
  return `<section class="panel"><h1>${tx("Rescheduling has closed", "改签已截止")}</h1>
    <p>${tx("The deadline was 30 minutes before your original screening. You can check your tickets in the original order.", "改签截止时间为原场次开场前 30 分钟。你可以在原订单中查看影票。")}</p>
    <a class="button" href="#/account?tab=orders&booking=${esc(bookingId)}">${tx("View original order", "查看原订单")}</a></section>`;
}

import { tx } from "./locale.js";
import { esc } from "./ui.js";

export function rescheduleDeadline(startsAt) {
  return Date.parse(startsAt) - 30 * 60 * 1000;
}

export function closedReschedule(bookingId, status = "CONFIRMED") {
  const heading = {
    CUSTOMER_CANCELLED: tx("The original booking was refunded", "原订单已退票"),
    CINEMA_CANCELLED: tx("The cinema cancelled the original screening", "影院已取消原场次"),
    RESCHEDULED: tx("The original booking was already rescheduled", "原订单已完成改签"),
  }[status] || tx("Rescheduling has closed", "改签已截止");
  const message = status === "CONFIRMED"
    ? tx("The deadline was 30 minutes before your original screening. You can check your tickets in the original order.", "改签截止时间为原场次开场前 30 分钟。你可以在原订单中查看影票。")
    : tx("This booking can no longer be changed. Open the original order for details.", "此订单已不能继续改签，请返回原订单查看详情。");
  return `<section class="panel"><h1>${heading}</h1><p>${message}</p>
    <a class="button" href="#/account?tab=orders&booking=${esc(bookingId)}">${tx("View original order", "查看原订单")}</a></section>`;
}

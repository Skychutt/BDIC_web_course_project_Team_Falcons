import { tx } from "./locale.js";

const messages = {
  SEAT_UNAVAILABLE: [
    "Some seats were just taken. The latest seat map is shown below; your previous hold is unchanged.",
    "部分座位刚被占用。请查看最新座位图，原有占座不受影响。",
  ],
  HOLD_EXPIRED: [
    "Your seat hold has ended. Select seats again to continue.",
    "占座已结束，请重新选座。",
  ],
  TOKEN_EXPIRED: [
    "This confirmation has expired. Review the latest amount before confirming again.",
    "确认已过期，请核对最新金额后重新确认。",
  ],
  QUOTE_CHANGED: [
    "The price or rescheduling fee has changed. Review a new quote before confirming.",
    "票价或改签费已变化，请核对最新报价。",
  ],
  INSUFFICIENT_BALANCE: [
    "There is not enough demo balance for this purchase. Your existing booking is unchanged.",
    "演示钱包余额不足，已有订单不受影响。",
  ],
  PREVIEW_CHANGED: [
    "The affected bookings have changed. Please review a new cancellation preview.",
    "相关订单已变化，请重新核对取消预览。",
  ],
  REVISION_CHANGED: [
    "This screening was updated. Reload its details before saving.",
    "场次已更新，请重新加载详情后再保存。",
  ],
  FORBIDDEN: [
    "You do not have permission to access this information.",
    "你没有查看此内容的权限。",
  ],
  LOGIN_REQUIRED: [
    "Please sign in to continue.",
    "请登录后继续。",
  ],
  CSRF: [
    "Your session needs refreshing. Reload this page before continuing.",
    "登录会话需要刷新，请重新加载页面。",
  ],
  RATE_LIMIT: [
    "Too many sign-in attempts. Please wait a minute and try again.",
    "尝试登录过于频繁，请稍后再试。",
  ],
  AI_NOT_CONFIGURED: [
    "AI conversation is not connected yet. You can still find live screenings with the filters.",
    "观影助手暂未连接，可以继续用筛选条件查找场次。",
  ],
  BUSY: [
    "The screening is being updated. Please retry the same action.",
    "场次正在更新，请稍后重试同一操作。",
  ],
  NETWORK: [
    "The response could not be confirmed. Retry this same action to safely recover the result.",
    "暂时无法确认操作结果，可以安全重试同一操作。",
  ],
  DATABASE_UNAVAILABLE: [
    "The service is temporarily unavailable. Retrying the same action will not duplicate a payment.",
    "服务暂时不可用。重试同一操作不会重复扣款。",
  ],
  REFUND_CLOSED: [
    "Refunds close 30 minutes before the screening.",
    "开场前 30 分钟停止退票。",
  ],
  RESCHEDULE_CLOSED: [
    "Rescheduling closes 30 minutes before your current screening.",
    "原场次开场前 30 分钟停止改签。",
  ],
};

const bookingMessagesZh = {
  SALE_CLOSED: "本场次已停止售票，请选择其他场次。",
  BOOKING_STATE: "订单状态已变化，请刷新后查看。",
  COUPON_INVALID: "这张优惠券已不可用，请重新选择。",
  RECEIPT_UNAVAILABLE: "暂时无法查询付款回执，请稍后重试。",
  LOGIN_FAILED: "邮箱或密码不正确。",
};

export function apiMessage(code, fallback) {
  const translation = Object.hasOwn(messages, code) ? messages[code] : null;
  if (translation) return tx(...translation);
  return tx(fallback, Object.hasOwn(bookingMessagesZh, code) ? bookingMessagesZh[code] : fallback);
}

export class CinemaAPI {
  constructor() {
    this.csrf = null;
    this.userId = "guest";
    this.authAction = null;
  }
  pending(name) {
    return Boolean(
      sessionStorage.getItem(`falcons.action.${this.userId}.${name}`),
    );
  }
  clearPending(name) {
    sessionStorage.removeItem(`falcons.action.${this.userId}.${name}`);
  }
  async init() {
    this.csrf = (await this.request("/auth/csrf")).csrf_token;
    return this;
  }
  async request(path, { method = "GET", body, requestKey, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (!["GET", "HEAD", "OPTIONS"].includes(method))
      headers["X-CSRF-Token"] = this.csrf || "";
    if (requestKey) headers["Idempotency-Key"] = requestKey;
    let response, payload;
    try {
      response = await fetch("/api" + path, {
        method,
        headers,
        credentials: "same-origin",
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      payload = await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      const e = new Error(messages.NETWORK[0]);
      e.code = "NETWORK";
      e.userMessage = apiMessage(e.code, e.message);
      throw e;
    }
    if (!response.ok) {
      const e = new Error(payload.error?.message || "Request failed");
      e.code = payload.error?.code;
      e.details = payload.error?.details;
      e.status = response.status;
      e.userMessage = apiMessage(e.code, e.message);
      throw e;
    }
    return payload.data;
  }
  async login(email, password) {
    const data = await this.request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    this.csrf = data.csrf_token;
    this.userId = data.user.id;
    return data.user;
  }
  async logout() {
    await this.request("/auth/logout", { method: "POST" });
    this.userId = "guest";
    this.csrf = null;
    await this.init();
  }
  async action(name, path, body, { signal } = {}) {
    // Store only a digest and random request key, never credentials or request bodies.
    const input = new TextEncoder().encode(JSON.stringify({ path, body }));
    const fingerprint = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", input)),
      (x) => x.toString(16).padStart(2, "0"),
    ).join("");
    const storageKey = `falcons.action.${this.userId}.${name}`;
    const sensitive = Object.hasOwn(body || {}, "password");
    let record = sensitive ? this.authAction : null;
    if (!sensitive)
      try {
        record = JSON.parse(sessionStorage.getItem(storageKey));
      } catch {}
    if (!record || record.fingerprint !== fingerprint) {
      record = { fingerprint, key: crypto.randomUUID() };
      if (sensitive) this.authAction = record;
      else sessionStorage.setItem(storageKey, JSON.stringify(record));
    }
    const clear = () => {
      if (sensitive) {
        if (this.authAction?.key === record.key) this.authAction = null;
      } else {
        let current;
        try {
          current = JSON.parse(sessionStorage.getItem(storageKey));
        } catch {}
        if (current?.key === record.key) sessionStorage.removeItem(storageKey);
      }
    };
    try {
      const data = await this.request(path, {
        method: "POST",
        body,
        requestKey: record.key,
        signal,
      });
      clear();
      return data;
    } catch (error) {
      if (error.status && error.status < 500 && error.code !== "BUSY") clear();
      throw error;
    }
  }
}

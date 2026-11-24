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
  QUOTE_REPLACED: [
    "This hold has a newer quote. Check your ticket choices and review the price again before paying.",
    "这笔占座已有新报价，请核对本页的票种和优惠，再重新核价付款。",
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

const messagesZh = {
  EMAIL_UNAVAILABLE: "验证码邮件暂时无法发送，请稍后再试。",
  REGISTRATION_RATE_LIMIT: "验证码请求过于频繁，请稍后再试。",
  REGISTRATION_CODE_REQUIRED: "请先为该邮箱获取注册验证码。",
  CUSTOMER_EMAIL: "请输入顾客账号的注册邮箱。",
  CODE_RATE_LIMIT: "该邮箱请求较频繁，请稍后再发。每分钟限一次，每小时最多十次。",
  CODE_EXPIRED: "验证码已失效，请重新发送。",
  CODE_INVALID: "验证码不正确，请核对邮件中的六位数字。",
  TICKET_INVALID: "影票链接无效，请从“我的影票”重新打开。",
  SCREEN_TYPE: "暂不支持此影厅类型。",
  IDEMPOTENCY_KEY: "请求编号格式无效，请重新发起操作。",
  CINEMA_INACTIVE: "请先指定影院经理并启用影院，再发布场次。",
  FILM_ARCHIVED: "已归档的影片无法新增场次。",
  SCHEDULE_OVERLAP: "该影厅的排期有冲突，请为两场放映预留 15 分钟清场时间。",
  SCREENING_STATE: "仅可取消尚未开场且已发布的场次。",
  REPLACEMENT_BRANCH: "替代场次必须安排在同一家影院。",
  LAYOUT_ROWS: "座位排号须从 1 开始连续编号。",
  LAYOUT_SEGMENT: "各座区的位置须从 1 开始连续编号。",
  LAYOUT_DUPLICATE: "座位编号、座区位置或座位坐标重复。",
  MANAGER_BRANCH: "经理必须是其负责门店的员工。",
  MANAGER_REPLACEMENT: "调动经理前，请从原门店指定另一位员工接任。",
  REFUND_STATE: "当前退款状态不支持此操作，请刷新查看。",
  TOKEN: "确认凭据无效或与本次操作不匹配，请重新核对。",
  CONSENT: "授权与当前交易不匹配，请核对员工编号和顾客分享的完整授权。",
  EMAIL_EXISTS: "此邮箱已注册。",
  NOT_FOUND: "找不到所请求的记录，请刷新后重试。",
  CONFLICT: "提交的信息与已有记录冲突，请核对后重试。",
  IDEMPOTENCY_CONFLICT: "此请求编号已用于另一笔操作，请重新发起请求。",
  RESCHEDULE_TARGET: "改签请选择同一影院、同一影片的其他场次。",
  SEAT_LAYOUT: "请选择本场次座位图中的座位。",
  FARE_SELECTION: "请为每个锁定的座位选择有效票种。",
  FARE_MIX: "改签时请保留原订单的人数和票种组合。",
  PARTY_SIZE: "改签须包含原订单的全部影票。",
  COUPON_INHERITED: "改签沿用原订单折扣，无需另外选择优惠券。",
  WALLET_MISSING: "顾客钱包暂不可用。",
  SALE_CLOSED: "本场次已停止售票，请选择其他场次。",
  BOOKING_STATE: "订单状态已变化，请刷新后查看。",
  COUPON_INVALID: "这张优惠券已不可用，请重新选择。",
  RECEIPT_UNAVAILABLE: "暂时无法查询付款回执，请稍后重试。",
  LOGIN_FAILED: "邮箱或密码不正确。",
};

const validationMessages = {
  "Choose a screening date on or before 9999-12-30.": "放映日期不得晚于 9999 年 12 月 30 日。",
  "Each seat must be an object": "座位数据格式无效。",
  "Invalid boolean filter": "筛选选项无效，请重新选择。",
  "Invalid film filter": "影片筛选条件无效。",
  "Invalid screen_type": "请选择有效的影厅类型。",
  "JSON object body is required": "提交的数据格式无效。",
  "Provide 1..5000 seats": "座位布局须包含 1 至 5,000 个座位。",
  "Provide structured filters": "筛选条件格式无效。",
  "Registration only accepts name, email and password": "注册时请填写姓名、邮箱和密码。",
  "Search text too long": "搜索内容过长，请缩短关键词。",
  "Seat IDs must be distinct": "请勿重复选择同一座位。",
  "Specify budget per ticket or total": "请选择单张票预算或总预算。",
  "Time range must be HH:MM": "请用“时:分”格式填写时间。",
  "Time range uses Beijing local HH:MM": "请按北京时间填写小时和分钟。",
  "Unknown booking status filter": "请选择有效的订单状态。",
  "Unknown fare type": "请选择有效的票种。",
  "Unknown search filter": "搜索条件无效。",
  "archived must be boolean": "请选择是否归档。",
  "date must be YYYY-MM-DD": "请按年-月-日格式填写日期。",
  "fares requires STANDARD and STUDENT prices in fen": "请同时提供标准票价和学生票价。",
  "genre_ids must be a list with at most 30 entries": "最多可选择 30 个影片类型。",
  "replacement must be an object": "替代场次格式无效。",
  "spoiler must be true or false": "请选择是否含有剧透。",
  "zone must be FRONT, MIDDLE or REAR": "请选择前排、中排或后排。",
  "Screening must start in the future": "开场时间必须晚于当前时间。",
  "Search text must be at most 100 characters": "搜索内容最多允许 100 个字符。",
  "Film title search needs at least two characters": "搜索片名时请至少输入两个字符。",
  "Invalid email": "请输入有效的邮箱地址。",
  "Password must contain 10..128 characters": "密码长度须为 10 至 128 个字符。",
  "Use a Beijing district code": "请输入有效的北京行政区划代码。",
  "Supply both coordinates in GCJ02": "请同时填写 GCJ-02 经纬度。",
  "Invalid coordinate range": "经纬度超出有效范围。",
  "Invalid coordinates": "请输入有效的经纬度。",
  "Invalid screen type": "请选择有效的影厅类型。",
  "Invalid screen direction": "请选择有效的银幕位置。",
  "from must precede to": "截止时间必须晚于起始时间。",
  "start_from must not be after start_to": "起始时间不可晚于截止时间。",
  "Rating must be 1 to 10": "评分须在 1 至 10 分之间。",
  "Choose 1..12 seats": "请选择 1 至 12 个座位。",
};

// The API includes limits and field names in validation errors.
function validationZh(message) {
  if (Object.hasOwn(validationMessages, message)) return validationMessages[message];
  const fields = {
    name: "名称", title: "标题", body: "正文", reason: "原因", address: "地址", brand: "品牌",
    synopsis: "剧情简介", display_name: "姓名", email: "邮箱", password: "密码", admin_code: "行政区划代码",
    duration_minutes: "片长", starts_at: "开场时间", row_count: "排数", stars: "评分",
    from: "起始时间", to: "截止时间", page: "页码", page_size: "每页条数", q: "搜索内容",
  };
  const field = message?.split(" ")[0];
  const label = Object.hasOwn(fields, field) ? fields[field] : "该字段";
  let match = /^\S+ length must be (\d+)\.\.(\d+)$/.exec(message);
  if (match) return `${label}长度须为 ${match[1]} 至 ${match[2]} 个字符。`;
  match = /^\S+ must be between (\d+) and (\d+)$/.exec(message);
  if (match) return `${label}须在 ${match[1]} 至 ${match[2]} 之间。`;
  if (/ must be an integer$/.test(message)) return `${label}须为整数。`;
  if (/ (requires an explicit timezone|must be an ISO 8601 timestamp with timezone)$/.test(message)) return `${label}须包含有效日期、时间和时区。`;
  return message;
}

export function apiMessage(code, fallback) {
  const translation = Object.hasOwn(messages, code) ? messages[code] : null;
  if (translation) return tx(...translation);
  if (code === "VALIDATION") return tx(fallback, validationZh(fallback));
  return tx(fallback, Object.hasOwn(messagesZh, code) ? messagesZh[code] : fallback);
}

class CinemaRequestError extends Error {
  get userMessage() { return apiMessage(this.code, this.message); }
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
      const e = new CinemaRequestError(messages.NETWORK[0]);
      e.code = "NETWORK";
      throw e;
    }
    if (!response.ok) {
      const e = new CinemaRequestError(payload.error?.message || "Request failed");
      e.code = payload.error?.code;
      e.details = payload.error?.details;
      e.status = response.status;
      throw e;
    }
    return payload.data;
  }
  async login(email, password) {
    const data = await this.request("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    return this.acceptSession(data);
  }
  async register(values) {
    return this.acceptSession(await this.action("register", "/auth/register", values));
  }
  acceptSession(data) {
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

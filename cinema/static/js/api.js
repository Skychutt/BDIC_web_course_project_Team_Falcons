const messages = {
  SEAT_UNAVAILABLE:
    "Some seats were just taken. The latest seat map is shown below; your previous hold is unchanged.",
  HOLD_EXPIRED: "Your seat hold has ended. Select seats again to continue.",
  TOKEN_EXPIRED:
    "This confirmation has expired. Request a fresh quote before paying.",
  QUOTE_CHANGED:
    "The price or rescheduling fee has changed. Review a new quote before confirming.",
  INSUFFICIENT_BALANCE:
    "There is not enough demo balance for this purchase. Your existing booking is unchanged.",
  PREVIEW_CHANGED:
    "The affected bookings have changed. Please review a new cancellation preview.",
  REVISION_CHANGED:
    "This screening was updated. Reload its details before saving.",
  FORBIDDEN: "You do not have permission to access this information.",
  LOGIN_REQUIRED: "Please sign in to continue.",
  CSRF: "Your session needs refreshing. Reload this page before continuing.",
  RATE_LIMIT: "Too many sign-in attempts. Please wait a minute and try again.",
  AI_NOT_CONFIGURED:
    "AI conversation is not connected yet. You can still find live screenings with the filters.",
  BUSY: "The screening is being updated. Please retry the same action.",
  NETWORK:
    "The response could not be confirmed. Retry this same action to safely recover the result.",
  DATABASE_UNAVAILABLE:
    "The service is temporarily unavailable. Retrying the same action will not duplicate a payment.",
  RESCHEDULE_CLOSED:
    "Rescheduling closes 30 minutes before your current screening.",
};
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
      const e = new Error(messages.NETWORK);
      e.code = "NETWORK";
      e.userMessage = messages.NETWORK;
      throw e;
    }
    if (!response.ok) {
      const e = new Error(payload.error?.message || "Request failed");
      e.code = payload.error?.code;
      e.details = payload.error?.details;
      e.status = response.status;
      e.userMessage = messages[e.code] || e.message;
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
  async action(name, path, body) {
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
      });
      clear();
      return data;
    } catch (error) {
      if (error.status && error.status < 500 && error.code !== "BUSY") clear();
      throw error;
    }
  }
}

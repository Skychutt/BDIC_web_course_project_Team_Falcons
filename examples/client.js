// Same-origin browser client. IDs remain strings; all amounts are integer fen.
export class CinemaAPI {
  constructor() { this.csrf = null; }
  async init() {
    this.csrf = (await this.request('/auth/csrf')).csrf_token;
    return this;
  }
  async request(path, { method = 'GET', body, requestKey } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) headers['X-CSRF-Token'] = this.csrf ?? '';
    if (requestKey) headers['Idempotency-Key'] = requestKey;
    const response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      const error = new Error(payload.error?.message ?? 'Request failed');
      error.code = payload.error?.code;
      error.status = response.status;
      error.details = payload.error?.details;
      throw error;
    }
    return payload.data;
  }
  async login(email, password) {
    if (!this.csrf) await this.init();
    const result = await this.request('/auth/login', { method: 'POST', body: { email, password } });
    this.csrf = result.csrf_token; // Login rotates the session and CSRF token.
    return result.user;
  }
  async logout() {
    await this.request('/auth/logout', { method: 'POST' });
    this.csrf = null;
  }
  search(filters = {}) {
    return this.request(`/screenings?${new URLSearchParams(filters)}`);
  }
  hold(screeningId, seatIds, requestKey, sourceBookingId = null) {
    return this.request('/holds', { method: 'POST', requestKey,
      body: { screening_id: screeningId, seat_ids: seatIds, source_booking_id: sourceBookingId } });
  }
  quote(holdId, tickets, couponId = null) {
    return this.request(`/holds/${holdId}/quote`, { method: 'POST', body: { tickets, coupon_id: couponId } });
  }
  // Call only after the customer confirms the displayed quote. For a network retry,
  // reuse the same quoteToken and requestKey instead of generating a new key.
  pay(quoteToken, requestKey, consentToken) {
    return this.request('/bookings', { method: 'POST', requestKey,
      body: { quote_token: quoteToken, ...(consentToken ? { consent_token: consentToken } : {}) } });
  }
}

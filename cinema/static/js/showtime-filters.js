const commonFilters = [
  "district_id", "cinema_id", "film_id", "genre_id", "date", "start_from",
  "start_to", "party_size", "screen_type", "zone",
];
const purchaseFilters = ["fare_type", "budget_minor", "budget_scope", "require_contiguous"];

// Only search criteria travel between pages. Pagination and checkout state belong to their own routes.
export function showtimeFilters(params, rescheduling) {
  const result = {};
  for (const name of rescheduling ? commonFilters : [...commonFilters, ...purchaseFilters]) {
    const value = params.get(name);
    if (value != null && value !== "") result[name] = value;
  }
  return result;
}

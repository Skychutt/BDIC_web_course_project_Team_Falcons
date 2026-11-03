// Both positions must use GCJ-02. Distances are straight-line estimates, not routes.
export function cinemaPosition(cinema) {
  if (cinema.coordinate_system !== "GCJ02" || cinema.longitude == null || cinema.latitude == null
      || String(cinema.longitude).trim() === "" || String(cinema.latitude).trim() === "") return null;
  const lng = Number(cinema.longitude), lat = Number(cinema.latitude);
  return Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? [lng, lat] : null;
}
export function distanceMetres(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad, dLng = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
export function orderedCinemas(cinemas, origin, district = "", nearest = false) {
  return cinemas.filter((c) => c.is_active && (!district || c.district_id === district)).map((c) => {
    const position = cinemaPosition(c);
    return { ...c, position, distance: position && origin ? distanceMetres(origin, position) : null };
  }).sort((a, b) => nearest && origin
    ? (a.distance ?? Infinity) - (b.distance ?? Infinity) || a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id))
    : a.name.localeCompare(b.name) || String(a.id).localeCompare(String(b.id)));
}

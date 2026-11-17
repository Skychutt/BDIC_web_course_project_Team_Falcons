/** Preserve empty grid rows: otherwise a cross aisle collapses in CSS Grid. */
export function seatGeometry(seats) {
  if (!seats.length) return { columns: 0, columnTracks: "", rowTracks: "", labels: [] };
  const columns = Math.max(...seats.map(s => s.map_x)) + 1;
  const height = Math.max(...seats.map(s => s.map_y)) + 1;
  const occupied = new Map();
  const occupiedColumns = new Set(seats.map(s => s.map_x));
  for (const s of seats) {
    if (!occupied.has(s.map_y)) occupied.set(s.map_y, new Set());
    occupied.get(s.map_y).add(s.row_no);
  }
  return {
    columns,
    columnTracks: Array.from({ length: columns }, (_, x) => occupiedColumns.has(x)
      ? "var(--seat-size)" : "var(--aisle-width)").join(" "),
    rowTracks: Array.from({ length: height }, (_, y) => occupied.has(y)
      ? "var(--seat-height)" : "var(--cross-aisle-height)").join(" "),
    labels: [...occupied].map(([y, rows]) => ({ y, label: rows.size === 1 ? [...rows][0] : "" })),
  };
}

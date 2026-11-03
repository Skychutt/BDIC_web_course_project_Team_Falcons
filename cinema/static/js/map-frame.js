import { loadAMap, toMapPosition, addressFor } from "./amap-sdk.js";
let map, AMap, markers = [], ready = false;
const send = (data) => parent.postMessage({ channel: "falcons-map", ...data }, location.origin);
const fail = () => {
  const error = document.getElementById("map-error");
  error.hidden = false;
  error.textContent = "地图暂时无法加载 / Map unavailable. Please retry.";
  send({ type: "error" });
};
window.addEventListener("error", () => { if (!ready) fail(); });
window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== "falcons-map" || !ready) return;
  const msg = event.data;
  if (msg.type === "render") {
    map.remove(markers); markers = [];
    for (const c of (msg.cinemas || []).slice(0, 200)) {
      if (!validPoint(c.position) || !/^\d+$/.test(c.id)) continue;
      const marker = new AMap.Marker({ position: c.position, title: String(c.name || ""),
        icon: "/static/assets/cinema-pin.svg", anchor: "bottom-center", offset: new AMap.Pixel(0, 0) });
      marker.on("click", () => send({ type: "cinema", id: c.id }));
      markers.push(marker);
    }
    if (validPoint(msg.position)) markers.push(new AMap.CircleMarker({ center: msg.position, radius: 8,
      fillColor: "#2168d9", fillOpacity: 1, strokeColor: "white", strokeWeight: 3 }));
    map.add(markers);
  } else if (msg.type === "focus" && validPoint(msg.position)) {
    map.setZoomAndCenter(Math.min(17, Math.max(3, Number(msg.zoom) || 10)), msg.position);
  } else if (msg.type === "convert" && validPoint(msg.position)) {
    try {
      const position = await toMapPosition(AMap, { longitude: msg.position[0], latitude: msg.position[1] });
      const address = await addressFor(AMap, position);
      send({ type: "converted", id: msg.id, position, address });
    } catch { send({ type: "conversion-error", id: msg.id }); }
  }
});
function validPoint(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}
try {
  const response = await fetch("/api/maps/config");
  const config = (await response.json()).data;
  AMap = await loadAMap(config);
  map = new AMap.Map("map", { viewMode: "2D", zoom: 10, center: [116.397428, 39.90923] });
  map.on("complete", () => { if (!ready) { ready = true; send({ type: "ready" }); } });
} catch { fail(); }

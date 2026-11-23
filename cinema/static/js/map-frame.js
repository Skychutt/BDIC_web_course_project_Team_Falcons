import { getLanguage } from "./locale.js";
import { createRoutePlanner } from "./map-route.js";
import { loadAMap, toMapPosition, addressFor } from "./amap-sdk.js";
let map, AMap, markers = [], ready = false, planner, routeVersion = 0, markerKey = "", userMarker;
const send = (data) => parent.postMessage({ channel: "falcons-map", ...data }, location.origin);
function localizeFrame(language = getLanguage()) {
  const tx = (en, zh) => language === "zh" ? zh : en;
  document.documentElement.lang = tx("en", "zh-CN");
  document.title = tx("Cinema map · AMap", "影院地图 · 高德地图");
  document.getElementById("map").setAttribute("aria-label", tx("AMap", "高德地图"));
  document.getElementById("route-panel").setAttribute("aria-label", tx("Driving and walking routes", "驾车与步行路线"));
  document.getElementById("map-error").textContent = tx("Map unavailable. Please retry.", "地图暂时无法加载，请重试。");
}
localizeFrame();
const fail = () => {
  const error = document.getElementById("map-error");
  error.hidden = false;
  send({ type: "error" });
};
window.addEventListener("error", () => { if (!ready) fail(); });
window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== "falcons-map" || !ready) return;
  const msg = event.data;
  if (msg.type === "clear-route") {
    ++routeVersion; planner?.clear();
  } else if (msg.type === "route" && validPoint(msg.origin) && validPoint(msg.destination)) {
    const version = ++routeVersion;
    const requested = (Array.isArray(msg.modes) ? msg.modes : [msg.mode || "walking"])
      .filter((mode) => mode === "walking" || mode === "driving");
    try {
      const details = await planner.searchModes(msg.origin, msg.destination, requested.length ? requested : ["walking"]);
      if (version === routeVersion) send({type:"routed", id:msg.id, ...details});
    } catch (error) {
      if (version === routeVersion) send({type:"route-error", id:msg.id, code:error.message});
    }
  } else if (msg.type === "render") {
    localizeFrame(msg.language);
    const cinemas = (msg.cinemas || []).slice(0, 200);
    const nextKey = JSON.stringify(cinemas);
    if (nextKey !== markerKey) {
    markerKey = nextKey;
    map.remove(markers); markers = [];
    for (const c of cinemas) {
      if (!validPoint(c.position) || !/^\d+$/.test(c.id)) continue;
      const marker = new AMap.Marker({ position: c.position, title: String(c.name || ""),
        icon: "/static/assets/cinema-pin.svg", anchor: "bottom-center", offset: new AMap.Pixel(0, 0) });
      marker.on("click", () => send({ type: "cinema", id: c.id }));
      markers.push(marker);
    }
    map.add(markers);
    }
    if (userMarker) { map.remove(userMarker); userMarker = null; }
    if (validPoint(msg.position)) {
      userMarker = new AMap.CircleMarker({ center: msg.position, radius: 8,
        fillColor: "#2168d9", fillOpacity: 1, strokeColor: "white", strokeWeight: 3 });
      map.add(userMarker);
    }
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
  const config = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { window.removeEventListener("message", receiveConfig); reject(new Error("config")); }, 10000);
    function receiveConfig(event) {
      if (event.source !== parent || event.origin !== location.origin || event.data?.channel !== "falcons-map" || event.data.type !== "config") return;
      localizeFrame(event.data.language);
      clearTimeout(timeout); window.removeEventListener("message", receiveConfig); resolve(event.data.config);
    }
    window.addEventListener("message", receiveConfig);
    send({type:"config-request"});
  });
  AMap = await loadAMap(config);
  map = new AMap.Map("map", { viewMode: "2D", zoom: 10, center: [116.397428, 39.90923] });
  planner = createRoutePlanner(AMap, map, document.getElementById("route-panel"));
  const markReady = () => { if (!ready) { ready = true; send({ type: "ready" }); } };
  map.on("complete", markReady);
  // Tile loading can stall. Route geometry can still be drawn on the existing map.
  setTimeout(markReady, 1500);
} catch { fail(); }

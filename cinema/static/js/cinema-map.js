import { esc, icon, options, empty } from "./ui.js";
import { orderedCinemas } from "./geo.js";
import { createMapFrame, locateDevice } from "./amap.js";

const words = {
  en: {
    title: "A big screen, near you.", intro: "Explore our Beijing cinemas and find your next showtime.",
    map: "Show map", locate: "Use my location", clear: "Clear location", district: "District", all: "All Beijing",
    nearest: "Sort by distance", privacy: "Location is optional. When you choose to locate, your browser asks permission and AMap converts the position. It stays in this page's memory and is not sent to the AI assistant.",
    idle: "Load AMap to explore the city, or browse cinemas below.", loading: "Loading AMap…", ready: "Map ready. Use my location to compare distances.", locating: "Requesting location…",
    located: "Location found", accuracy: "Reported accuracy", unknownCity: "City could not be verified.",
    outside: "Your location is outside Beijing. This platform currently lists Beijing cinemas only.",
    unavailable: "Location is unavailable. Try again or choose a district manually.", denied: "Location permission was denied. Allow it in your browser settings or choose a district manually.",
    timeout: "Location timed out. Try again or choose a district manually.", insecure: "Location needs HTTPS or a local localhost connection.", unsupported: "This browser does not support location.",
    conversion: "AMap could not convert the position. Try again or choose a district manually.",
    load_failed: "AMap could not load. Check the connection and map configuration, or continue browsing below.",
    not_configured: "Map service is not configured yet. You can still browse cinemas and showtimes.",
    unlocated: "Map position pending", missing: "cinema(s) have no map coordinates. Their distance cannot be calculated.",
    count: "cinemas", distance: "Straight-line distance", showtimes: "See showtimes", onMap: "Show on map", nomatch: "No cinemas in this district.",
    expired: "Location cleared after 10 minutes. Locate again for fresh distances.", mapLabel: "AMap cinema map", you: "Your approximate location",
    noPins: "No cinema coordinates have been added yet. The map shows Beijing; no cinema markers or distances are invented.",
  },
  zh: {
    title: "找到附近的好影院", intro: "浏览北京影院，查看地址与可售场次。",
    map: "显示地图", locate: "定位我的位置", clear: "清除位置", district: "行政区", all: "北京全市",
    nearest: "按距离排序", privacy: "定位为可选功能。点击定位后，浏览器会请求授权，高德会进行坐标转换。位置仅保留在当前页面内存，不发送给 AI 助手。",
    idle: "打开高德地图浏览城市，或直接查看下方影院。", loading: "正在加载高德地图…", ready: "地图已加载，可点击定位比较距离。", locating: "正在请求定位…",
    located: "定位成功", accuracy: "设备报告精度", unknownCity: "暂时无法确认所在城市。",
    outside: "你的位置在北京以外，平台目前仅有北京影院。",
    unavailable: "暂时无法定位，请重试或手动选择行政区。", denied: "浏览器未授权定位。可在浏览器设置中允许，或手动选择行政区。",
    timeout: "定位超时，请重试或手动选择行政区。", insecure: "定位需要 HTTPS 或本机 localhost 环境。", unsupported: "当前浏览器不支持定位。",
    conversion: "高德坐标转换暂时失败，请重试或手动选择行政区。",
    load_failed: "高德地图加载失败，请检查网络和地图配置，也可继续浏览下方影院。",
    not_configured: "尚未配置地图服务，可继续浏览影院和场次。",
    unlocated: "地图位置待补充", missing: "家影院尚未填写地图坐标，暂时无法计算距离。",
    count: "家影院", distance: "直线距离", showtimes: "查看场次", onMap: "在地图中查看", nomatch: "该区域暂无影院。",
    expired: "位置已在 10 分钟后清除，请重新定位。", mapLabel: "高德影院地图", you: "你的大致位置",
    noPins: "当前影院尚未填写坐标。地图先显示北京，暂不展示影院标记和距离。",
  },
};

export async function renderCinemaMap(ctx) {
  const { root, api, bootstrap } = ctx;
  let config;
  try { config = await api.request("/maps/config"); } catch { config = { enabled: false }; }
  let language = "en", district = "", nearest = false, position = null, address = null, accuracy = null;
  let map, disposed = false, running = false, expireTimer, requestVersion = 0;
  let status = config.enabled ? "idle" : "not_configured";
  const t = (key) => words[language][key] || words[language].unavailable;
  const readyStatus = () => bootstrap.cinemas.some((c) => c.coordinate_system === "GCJ02" && c.latitude != null && c.longitude != null) ? "ready" : "noPins";
  const el = (name) => root.querySelector(`[data-map="${name}"]`);
  const locatedText = () => {
    const city = address?.city?.length ? address.city : address?.province;
    const region = [city, address?.district].filter((s) => typeof s === "string").join(" · ");
    const outside = address?.adcode && !String(address.adcode).startsWith("11");
    return `${t("located")}${region ? " · " + region : " · " + t("unknownCity")}${accuracy != null ? ` · ${t("accuracy")} ±${Math.round(accuracy)} m` : ""}${outside ? " · " + t("outside") : ""}`;
  };
  function message() {
    el("status").textContent = status === "located" ? locatedText() : t(status);
    el("locate").disabled = running || !config.enabled;
    el("load").disabled = running || !config.enabled;
    el("clear").hidden = !position;
    el("nearest").disabled = !position;
    el("nearest").checked = nearest;
  }
  function clearLocation(nextStatus = "ready") {
    ++requestVersion;
    clearTimeout(expireTimer);
    position = address = accuracy = null;
    nearest = false;
    status = map ? nextStatus : config.enabled ? "idle" : "not_configured";
    message(); draw();
    if (map) map.focus([116.397428, 39.90923], 10);
  }
  function draw() {
    const values = orderedCinemas(bootstrap.cinemas, position, district, nearest);
    const missing = values.filter((c) => !c.position).length;
    el("count").textContent = `${values.length} ${t("count")}`;
    el("missing").textContent = missing ? `${missing} ${t("missing")}` : "";
    el("list").innerHTML = values.map((c) => `<article class="cinema-card"><div class="cinema-card-top">${esc(c.district_name || "Beijing")}</div><div class="cinema-card-body"><p class="eyebrow">${esc(c.brand)}</p><h2>${esc(c.name)}</h2><p>${icon("pin")} ${esc(c.address)}</p><p class="cinema-distance">${c.distance != null ? `${t("distance")} · ${(c.distance / 1000).toFixed(1)} km` : c.position ? "" : t("unlocated")}</p><div class="map-card-actions"><a class="button ghost wide" href="#/discover?${new URLSearchParams({ cinema_id: c.id, district_id: c.district_id })}">${t("showtimes")} ${icon("arrow")}</a>${c.position ? `<button type="button" class="button secondary wide" data-pin="${esc(c.id)}">${t("onMap")}</button>` : ""}</div></div></article>`).join("") || empty(t("nomatch"));
    el("list").querySelectorAll("[data-pin]").forEach((button) => {
      button.onclick = () => run(async () => {
        await ensureMap();
        const cinema = values.find((c) => c.id === button.dataset.pin);
        if (!disposed && cinema?.position) { map.focus(cinema.position, 15); el("canvas").scrollIntoView({ block: "center", behavior: "smooth" }); }
      });
    });
    if (!map) return;
    map.render(values.filter((c) => c.position).map((c) => ({ id:c.id, name:c.name, position:c.position })), position);
  }
  async function ensureMap() {
    if (map) { await map.ready; return; }
    if (disposed) return;
    if (!config.enabled) throw new Error("not_configured");
    el("canvas").hidden = false;
    const frame = createMapFrame(el("canvas"), (id) => {
      const cinema = bootstrap.cinemas.find((c) => c.id === id && c.is_active);
      if (cinema) ctx.navigate("#/discover?" + new URLSearchParams({cinema_id:cinema.id, district_id:cinema.district_id}));
    }, config);
    map = frame;
    try { await frame.ready; }
    catch (error) { frame.destroy(); if (map === frame) map = null; throw error; }
    if (disposed) return;
    status = readyStatus();
    draw(); message();
  }
  async function run(task) {
    if (running || disposed) return;
    running = true; message();
    try { await task(); }
    catch (error) { if (!disposed) status = words.en[error.message] ? error.message : "load_failed"; }
    finally { running = false; if (!disposed) message(); }
  }
  function mount() {
    const existingFrame = el("canvas")?.querySelector("iframe");
    root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">FALCONS · BEIJING</p><h1>${t("title")}</h1><p class="muted">${t("intro")}</p></div><button class="button ghost" data-map="language">${language === "zh" ? "English" : "中文"}</button></div><section class="cinema-map-panel"><div class="map-controls"><button type="button" class="button secondary" data-map="load">${t("map")}</button><button type="button" class="button" data-map="locate">${icon("pin")} ${t("locate")}</button><button type="button" class="button ghost" data-map="clear" hidden>${t("clear")}</button></div><p class="fine-print">${t("privacy")}</p><p class="map-status" data-map="status" role="status" aria-live="polite"></p><div class="cinema-map-canvas" data-map="canvas" role="region" aria-label="${t("mapLabel")}" hidden></div></section><div class="map-list-toolbar"><label class="field"><span>${t("district")}</span><select data-map="district">${options(bootstrap.districts, district, "name", t("all"))}</select></label><label class="map-nearest"><input type="checkbox" data-map="nearest"> ${t("nearest")}</label><span class="muted" data-map="count"></span></div><p class="fine-print" data-map="missing"></p><div class="cinema-grid" data-map="list"></div>`;
    if (existingFrame) { el("canvas").hidden = false; el("canvas").append(existingFrame); }
    root.lang = language === "zh" ? "zh-CN" : "en";
    el("language").onclick = () => {
      if (running) return;
      const hadMap = !!map;
      language = language === "en" ? "zh" : "en"; mount();
      if (hadMap) run(async () => { await ensureMap(); if (position) { map.focus(position, 13); status = "located"; } });
    };
    el("load").onclick = () => run(async () => { status = "loading"; message(); await ensureMap(); status = position ? "located" : readyStatus(); });
    el("locate").onclick = () => run(async () => {
      const version = ++requestVersion;
      // Clear stale position before a fresh request; never show an old distance as new.
      clearTimeout(expireTimer); position = address = accuracy = null; nearest = false;
      status = "locating"; message(); draw();
      const result = await locateDevice();
      if (disposed || version !== requestVersion) return;
      await ensureMap();
      if (disposed || version !== requestVersion) return;
      status = "locating"; message();
      const converted = await map.convert(result.coords);
      const next = converted.position, region = converted.address;
      if (disposed || version !== requestVersion) return;
      position = next; address = region; accuracy = result.coords.accuracy; nearest = true;
      status = "located"; draw(); map.focus(position, 13);
      expireTimer = setTimeout(() => { if (!disposed) clearLocation("expired"); }, 10 * 60 * 1000);
    });
    el("clear").onclick = () => clearLocation();
    el("district").onchange = () => { district = el("district").value; draw(); };
    el("nearest").onchange = () => { nearest = el("nearest").checked; draw(); };
    draw(); message();
  }
  mount();
  return () => { disposed = true; ++requestVersion; clearTimeout(expireTimer); map?.destroy(); position = address = null; };
}

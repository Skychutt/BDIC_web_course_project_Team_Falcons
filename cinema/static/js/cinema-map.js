import { esc, icon, options, empty } from "./ui.js";
import { getLanguage } from "./locale.js";
import { orderedCinemas } from "./geo.js";
import { createMapFrame, locateDevice } from "./amap.js";

const words = {
  en: {
    route_connection: "Cannot connect securely to AMap. Check your network or proxy and try again.",
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
    drive: "Driving", walk: "Walking", routes: "Driving and walking routes", route_permission: "AMap key does not permit this route service. Check key permissions.", route_timeout: "AMap route request timed out. Please retry.", route_no_data: "No road route was returned for these locations.", routing: "Planning driving and walking routes…", routed: "Driving and walking routes are on the map.", routed_partial: "One route is on the map. The other could not be planned.", route_short_unavailable: "Unavailable", route_failed: "Route unavailable. Try a nearer cinema or retry later.",
    noPins: "No cinema coordinates have been added yet. The map shows Beijing; no cinema markers or distances are invented.",
  },
  zh: {
    route_connection: "无法安全连接高德路线服务，请检查网络或代理后重试。",
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
    drive: "驾车", walk: "步行", routes: "显示驾车和步行路线", route_permission: "高德Key未获当前路线服务授权，请检查平台类型和接口权限。", route_timeout: "高德路线请求超时，请重试。", route_no_data: "高德没有返回可用的道路路线。", routing: "正在规划驾车和步行路线…", routed: "驾车和步行路线已显示在地图上。", routed_partial: "已画出可用路线，另一条暂时无法规划。", route_short_unavailable: "暂不可用", route_failed: "暂时无法规划路线，请选择较近的影院或稍后重试。",
    noPins: "当前影院尚未填写坐标。地图先显示北京，暂不展示影院标记和距离。",
  },
};

// District IDs belong to each installation. The administrative codes are shared.
const districtNamesZh = {
  "110101": "东城区", "110102": "西城区", "110105": "朝阳区", "110106": "丰台区",
  "110107": "石景山区", "110108": "海淀区", "110109": "门头沟区", "110111": "房山区",
  "110112": "通州区", "110113": "顺义区", "110114": "昌平区", "110115": "大兴区",
  "110116": "怀柔区", "110117": "平谷区", "110118": "密云区", "110119": "延庆区",
};

const cinemaPhotos = {
  "万达影城(CBD万达广场店)": {
    "src": "/static/assets/cinemas/wanda-cbd.webp",
    "alt": "北京CBD万达广场建筑外观",
    "source": "https://www.wanda-cbd.cn/index.html",
    "caption": "所在建筑"
  },
  "万达影城(西铁营店)": {
    "src": "/static/assets/cinemas/wanda-xitieying.webp",
    "alt": "北京西铁营万达广场夜间外观",
    "source": "https://www.sohu.com/picture/772923275",
    "caption": "所在建筑"
  },
  "保利国际影城(凯德大峡谷店)": {
    "src": "/static/assets/cinemas/poly-canyon.webp",
    "alt": "北京凯德大峡谷商场及保利电影院线外观",
    "source": "https://www.theedgesingapore.com/capital/results/capitaland-china-trusts-fy2023-dpu-falls-101-retail-improves-new-economy-struggles",
    "caption": "所在建筑"
  },
  "中华电影院": {
    "src": "/static/assets/cinemas/zhonghua.webp",
    "alt": "北京中华电影院历史外观，非当前门面照片",
    "source": "https://www.sohu.com/a/333425910_120047053",
    "caption": "历史外观"
  },
  "北京站电影院": {
    "src": "/static/assets/cinemas/beijing-station.webp",
    "alt": "影院周边的北京站建筑外观，非影院入口",
    "source": "https://www.sohu.com/a/786121631_121117452",
    "caption": "周边地标"
  },
  "北京横店影城(王府井百货店)": {
    "src": "/static/assets/cinemas/hengdian-wangfujing.webp",
    "alt": "横店影城所在的北京王府井百货大楼夜间外观",
    "source": "https://4travel.jp/os_shisetsu/10408729",
    "caption": "所在建筑"
  },
  "首都电影院(西单店)": {
    "src": "/static/assets/cinemas/capital-xidan.webp",
    "alt": "首都电影院西单大悦城店入口",
    "source": "https://www.zaobao.com.sg/news/china/story20260208-8384125",
    "caption": "影院入口"
  },
  "英皇电影城(北京英皇中心店)": {
    "src": "/static/assets/cinemas/emperor-centre.jpg",
    "alt": "影院所在的北京英皇集团中心建筑入口",
    "source": "https://you.ctrip.com/travels/beijing1/4020412.html",
    "caption": "所在建筑"
  },
  "北京地质礼堂": {
    "src": "/static/assets/cinemas/geological-hall.png",
    "alt": "北京地质礼堂与开心麻花剧场共用的场馆入口",
    "source": "https://xinwen.bjd.com.cn/content/s60ee3face4b003a0f669be16.html",
    "caption": "场馆入口"
  }
};
function cinemaCover(cinema) {
  const photo = cinemaPhotos[cinema.name];
  return `<div class="cinema-card-top cinema-photo-cover">${photo ? `<img src="${photo.src}" alt="${esc(photo.alt)}" loading="lazy" decoding="async" width="1200" height="800">` : ""}<span class="cinema-cover-label"><small>BEIJING · CINEMA</small><span>${esc(cinema.district_name || "Beijing")}</span></span>${photo ? `<a class="cinema-photo-credit" href="${photo.source}" target="_blank" rel="noopener noreferrer">${esc(photo.caption)} · 来源 ↗</a>` : ""}</div>`;
}
export async function renderCinemaMap(ctx) {
  const { root, api, bootstrap } = ctx;
  const districts = bootstrap.districts.map((d) => ({
    ...d, nameZh: districtNamesZh[d.admin_code] ?? d.name,
  }));
  let config;
  try { config = await api.request("/maps/config"); } catch { config = { enabled: false }; }
  let language = getLanguage(), district = "", nearest = false, position = null, address = null, accuracy = null;
  let activeCinemaId = null, routeInfo = null;
  let locate;
  let map, disposed = false, running = false, expireTimer, requestVersion = 0;
  let mapAvailable = config.enabled;
  const routesDisabled = () => running || !mapAvailable;
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
    root.querySelectorAll("[data-route]").forEach((button) => {
      button.disabled = routesDisabled();
    });
    el("clear").hidden = !position;
    el("nearest").disabled = !position;
    el("nearest").checked = nearest;
    const legend = el("legend");
    if (legend) legend.hidden = !routeInfo;
  }
  function clearLocation(nextStatus = "ready") {
    ++requestVersion;
    clearTimeout(expireTimer);
    map?.clearRoute();
    activeCinemaId = routeInfo = null;
    position = address = accuracy = null;
    nearest = false;
    status = map ? nextStatus : config.enabled ? "idle" : "not_configured";
    message(); draw();
    if (map) map.focus([116.397428, 39.90923], 10);
  }
  function routeSummary(cinema) {
    if (!routeInfo || String(routeInfo.id) !== String(cinema.id)) return "";
    const line = (mode, label) => {
      const found = routeInfo.routes.find((route) => route.mode === mode);
      const distance = Number(found?.distance), time = Number(found?.time);
      const detail = found && Number.isFinite(distance)
        ? `${(distance / 1000).toFixed(1)} km${Number.isFinite(time) ? ` · ${Math.ceil(time / 60)} ${language === "zh" ? "分钟" : "min"}` : ""}`
        : t("route_short_unavailable");
      return `<p class="cinema-route-line"><i class="route-swatch route-${mode}"></i><span>${label} · ${detail}</span></p>`;
    };
    return line("driving", t("drive")) + line("walking", t("walk"));
  }
  function draw(updateMap = true) {
    const values = orderedCinemas(bootstrap.cinemas, position, district, nearest);
    const missing = values.filter((c) => !c.position).length;
    el("count").textContent = `${values.length} ${t("count")}`;
    el("missing").textContent = missing ? `${missing} ${t("missing")}` : "";
    el("list").innerHTML = values.map((c) => `<article class="cinema-card${String(activeCinemaId) === String(c.id) ? " is-selected" : ""}" data-cinema="${esc(c.id)}">${cinemaCover(c)}<div class="cinema-card-body"><p class="eyebrow">${esc(c.brand)}</p><h2>${esc(c.name)}</h2><p>${icon("pin")} ${esc(c.address)}</p><p class="cinema-distance">${c.distance != null ? `${t("distance")} · ${(c.distance / 1000).toFixed(1)} km` : c.position ? "" : t("unlocated")}</p>${routeSummary(c)}<div class="map-card-actions"><a class="button ghost wide" href="#/discover?${new URLSearchParams({ cinema_id: c.id, district_id: c.district_id })}">${t("showtimes")} ${icon("arrow")}</a>${c.position ? `<button type="button" class="button secondary wide" data-pin="${esc(c.id)}">${t("onMap")}</button><button type="button" class="button wide" data-route="${esc(c.id)}">${t("routes")}</button>` : ""}</div></div></article>`).join("") || empty(t("nomatch"));
    el("list").querySelectorAll("[data-pin]").forEach((button) => {
      button.onclick = () => run(async () => {
        await ensureMap();
        const cinema = values.find((c) => String(c.id) === button.dataset.pin);
        if (!disposed && cinema?.position) { map.focus(cinema.position, 15); el("canvas").scrollIntoView({ block: "center", behavior: "smooth" }); }
      });
    });
    el("list").querySelectorAll("[data-route]").forEach((button) => {
      button.disabled = routesDisabled();
      button.onclick = () => run(async () => {
        const cinema = values.find((c) => String(c.id) === button.dataset.route);
        if (!cinema?.position) return;
        if (!position) await locate();
        if (disposed || !position) return;
        await ensureMap();
        if (disposed || !position) return;
        activeCinemaId = cinema.id;
        routeInfo = null;
        status = "routing";
        message();
        el("canvas").scrollIntoView({block:"center", behavior:"smooth"});
        try {
          const details = await map.route(position, cinema.position, ["walking", "driving"]);
          if (disposed) return;
          const routes = Array.isArray(details?.routes) ? details.routes : [];
          const errors = Array.isArray(details?.errors) ? details.errors : [];
          if (!routes.length) throw new Error(errors[0]?.code || "route_failed");
          routeInfo = { id: cinema.id, routes, errors };
          status = errors.length ? "routed_partial" : "routed";
        } catch (error) {
          activeCinemaId = routeInfo = null;
          if (!disposed) draw();
          throw error;
        }
        if (!disposed) draw();
      });
    });
    if (!map || !updateMap) return;
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
    catch (error) {
      mapAvailable = false;
      frame.destroy();
      if (map === frame) map = null;
      throw error;
    }
    if (disposed) return;
    mapAvailable = true;
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
    root.innerHTML = `<div class="page-heading"><div><p class="eyebrow">FALCONS · BEIJING</p><h1 data-map-copy="title"></h1><p class="muted" data-map-copy="intro"></p></div></div>
      <section class="cinema-map-panel">
        <div class="map-controls">
          <button type="button" class="button secondary" data-map="load" data-map-copy="map"></button>
          <button type="button" class="button" data-map="locate">${icon("pin")} <span data-map-copy="locate"></span></button>
          <button type="button" class="button ghost" data-map="clear" data-map-copy="clear" hidden></button>
        </div>
        <p class="fine-print" data-map-copy="privacy"></p>
        <p class="map-status" data-map="status" role="status" aria-live="polite"></p>
        <p class="route-legend" data-map="legend" hidden>
          <span><i class="route-swatch route-driving"></i><span data-map-copy="drive"></span></span>
          <span><i class="route-swatch route-walking"></i><span data-map-copy="walk"></span></span>
        </p>
        <div class="cinema-map-canvas" data-map="canvas" role="region" hidden></div>
      </section>
      <div class="cinema-list-toolbar">
        <label class="field"><span data-map-copy="district"></span><select data-map="district"></select></label>
        <label class="map-nearest"><input type="checkbox" data-map="nearest"><span data-map-copy="nearest"></span></label>
        <span class="muted" data-map="count"></span>
      </div>
      <p class="fine-print" data-map="missing"></p>
      <div class="cinema-grid" data-map="list"></div>`;
    el("load").onclick = () => run(async () => { status = "loading"; message(); await ensureMap(); status = position ? "located" : readyStatus(); });
    el("locate").onclick = () => run(locate);
    locate = async function () {
      const version = ++requestVersion;
      // Clear stale position before a fresh request; never show an old distance as new.
      map?.clearRoute();
      activeCinemaId = routeInfo = null;
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
    };
    el("clear").onclick = () => clearLocation();
    el("district").onchange = () => { district = el("district").value; draw(); };
    el("nearest").onchange = () => { nearest = el("nearest").checked; draw(); };
  }
  function updateLanguage() {
    language = getLanguage();
    root.lang = language === "zh" ? "zh-CN" : "en";
    root.querySelectorAll("[data-map-copy]").forEach((node) => {
      node.textContent = t(node.dataset.mapCopy);
    });
    el("canvas").setAttribute("aria-label", t("mapLabel"));
    el("district").innerHTML = options(districts, district, language === "zh" ? "nameZh" : "name", t("all"));
    // Keep the live map, location and any plotted routes across a language change.
    draw(false);
    message();
  }
  ctx.updateLanguage = updateLanguage;
  mount();
  updateLanguage();
  return () => { disposed = true; ++requestVersion; clearTimeout(expireTimer); map?.destroy(); position = address = null; };
}

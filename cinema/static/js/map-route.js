// Render actual provider road geometry; never substitute a straight-line route.
const MODES = {
  walking: { label: "步行 / Walking", color: "#e26a00", zIndex: 72 },
  driving: { label: "驾车 / Driving", color: "#2168d9", zIndex: 70 },
};
const ERROR_RANK = ["route_connection", "route_timeout", "route_permission", "route_cancelled", "route_no_data", "route_failed"];

function asPath(path) {
  if (!path) return null;
  const points = Array.isArray(path) ? path : typeof path.length === "number" ? Array.from(path) : null;
  return points && points.length > 1 ? points : null;
}

function decodePolyline(value) {
  if (typeof value !== "string" || !value.includes(",")) return null;
  const points = value.split(";").map((pair) => pair.split(",").map(Number));
  return points.length > 1 && points.every((point) => point.length >= 2 && point.slice(0, 2).every(Number.isFinite))
    ? points.map((point) => point.slice(0, 2))
    : null;
}

function pathsFrom(route) {
  const paths = [];
  for (const step of route?.steps || []) {
    const path = asPath(step?.path) || decodePolyline(step?.polyline);
    if (path) paths.push(path);
  }
  if (!paths.length) {
    const whole = asPath(route?.path) || decodePolyline(route?.polyline);
    if (whole) paths.push(whole);
  }
  return paths;
}

function failureCode(status, result) {
  const info = String(result?.info || result || "");
  if (/MAP_CONNECTION/.test(info)) return "route_connection";
  if (/MAP_TIMEOUT/.test(info)) return "route_timeout";
  if (status === "no_data") return "route_no_data";
  if (/KEY|USER|PLATFORM|REFERER|PERMISSION|PRIVILEGE/i.test(info)) return "route_permission";
  return "route_failed";
}

function bestError(errors) {
  return errors.slice().sort((a, b) => {
    const rank = (code) => {
      const index = ERROR_RANK.indexOf(code);
      return index === -1 ? ERROR_RANK.length : index;
    };
    return rank(a.code) - rank(b.code);
  })[0]?.code || "route_failed";
}

export function createRoutePlanner(AMap, map, panel) {
  let version = 0, overlays = [], services = [], aborters = [], cancel;
  function clear() {
    ++version;
    const abortSearch = cancel;
    cancel = null;
    for (const abort of aborters) abort();
    aborters = [];
    abortSearch?.();
    for (const service of services) service.clear?.();
    services = [];
    if (overlays.length) map.remove(overlays);
    overlays = [];
    panel.replaceChildren();
    panel.hidden = true;
  }
  function query(mode, origin, destination, current) {
    const name = mode === "driving" ? "Driving" : "Walking";
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => end(new Error("route_timeout")), 20000);
      function end(error, value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(value);
      }
      aborters.push(() => end(new Error("route_cancelled")));
      try {
        AMap.plugin("AMap." + name, () => {
          if (done || current !== version) return end(new Error("route_cancelled"));
          try {
            const service = new AMap[name]({ hideMarkers: true, autoFitView: false });
            services.push(service);
            service.search(origin, destination, (status, result) => {
              if (done || current !== version) return end(new Error("route_cancelled"));
              if (status !== "complete") return end(new Error(failureCode(status, result)));
              const route = result?.routes?.[0];
              const paths = pathsFrom(route);
              if (!paths.length) return end(new Error("route_no_data"));
              end(null, { mode, route, paths });
            });
          } catch { end(new Error("route_failed")); }
        });
      } catch { end(new Error("route_failed")); }
    });
  }
  function draw(origin, destination, planned) {
    overlays = planned.flatMap((item) => item.paths.map((path) => new AMap.Polyline({
      path,
      strokeColor: MODES[item.mode].color,
      strokeWeight: item.mode === "walking" ? 6 : 7,
      strokeOpacity: 0.95,
      isOutline: true,
      outlineColor: "white",
      borderWeight: 2,
      showDir: true,
      zIndex: MODES[item.mode].zIndex,
    })));
    overlays.push(
      new AMap.Marker({ position: origin, title: "起点 / Start", zIndex: 80 }),
      new AMap.Marker({ position: destination, title: "影院 / Cinema", zIndex: 80 }),
    );
    map.add(overlays);
    map.setFitView(overlays, false, [50, 50, 50, 50]);
    panel.replaceChildren(...planned.map((item) => {
      const distance = Number(item.route.distance), time = Number(item.route.time);
      const heading = document.createElement("strong");
      heading.className = "route-label route-" + item.mode;
      heading.textContent = MODES[item.mode].label
        + (Number.isFinite(distance) ? ` · ${(distance / 1000).toFixed(1)} km` : "")
        + (Number.isFinite(time) ? ` · ${Math.ceil(time / 60)} min` : "");
      const list = document.createElement("ol");
      for (const step of item.route.steps || []) {
        const entry = document.createElement("li");
        entry.textContent = step.instruction || "继续前行 / Continue";
        list.append(entry);
      }
      const block = document.createElement("section");
      block.className = "route-block";
      block.append(heading, list);
      return block;
    }));
    panel.hidden = false;
  }
  function searchModes(origin, destination, modes) {
    clear();
    const requested = [...new Set((modes || []).filter((mode) => MODES[mode]))];
    const current = version;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("route_timeout")), 35000);
      function finish(error, value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cancel = null;
        if (error) reject(error);
        else resolve(value);
      }
      cancel = () => finish(new Error("route_cancelled"));
      if (!requested.length) return finish(new Error("route_failed"));
      Promise.allSettled(requested.map((mode) => query(mode, origin, destination, current))).then((results) => {
        if (settled || current !== version) return;
        try {
          const planned = results.filter((item) => item.status === "fulfilled").map((item) => item.value);
          const errors = results.flatMap((item, index) => item.status === "rejected"
            ? [{ mode: requested[index], code: item.reason?.message || "route_failed" }]
            : []);
          if (!planned.length) return finish(new Error(bestError(errors)));
          draw(origin, destination, planned);
          finish(null, {
            routes: planned.map((item) => ({ mode: item.mode, distance: Number(item.route.distance), time: Number(item.route.time) })),
            errors,
          });
        } catch {
          finish(new Error("route_failed"));
          clear();
        }
      });
    });
  }
  function search(origin, destination, mode = "walking") {
    return searchModes(origin, destination, [mode]).then((summary) => {
      const route = summary.routes[0];
      if (!route) throw new Error(summary.errors[0]?.code || "route_failed");
      return { distance: route.distance, time: route.time };
    });
  }
  return { search, searchModes, clear };
}

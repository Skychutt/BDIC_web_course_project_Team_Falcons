// Render actual provider road geometry; never substitute a straight-line route.
export function createRoutePlanner(AMap, map, panel) {
  let version = 0, overlays = [], service, cancel;
  function clear() {
    ++version; cancel?.(); cancel = null; service?.clear(); service = null;
    if (overlays.length) map.remove(overlays);
    overlays = []; panel.replaceChildren(); panel.hidden = true;
  }
  function search(origin, destination, mode = "walking") {
    clear();
    const current = version;
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => finish(new Error("route_timeout")), 35000);
      function finish(error, value) {
        if (settled) return;
        settled = true; clearTimeout(timer); cancel = null;
        if (error) reject(error); else resolve(value);
      }
      cancel = () => finish(new Error("route_cancelled"));
      const name = mode === "driving" ? "Driving" : "Walking";
      try { AMap.plugin("AMap." + name, () => {
        if (current !== version || settled) return;
        try {
          service = new AMap[name]({hideMarkers:true});
          service.search(origin, destination, (status, result) => {
            if (current !== version || settled) return;
            if (status !== "complete") {
              const info = String(result?.info || result || "");
              const code = /KEY|USER|PLATFORM|REFERER|PERMISSION|PRIVILEGE/i.test(info) ? "route_permission" : "route_failed";
              return finish(new Error(code));
            }
            try {
              const route = result?.routes?.[0];
              const paths = (route?.steps || []).map(step => step.path).filter(path => Array.isArray(path) && path.length > 1);
              if (!paths.length) return finish(new Error("route_no_data"));
              overlays = paths.map(path => new AMap.Polyline({path, strokeColor:"#2168d9", strokeWeight:7, strokeOpacity:0.95, isOutline:true, outlineColor:"white", borderWeight:2, showDir:true, zIndex:70}));
              overlays.push(new AMap.Marker({position:origin,title:"起点 / Start"}), new AMap.Marker({position:destination,title:"影院 / Cinema"}));
              map.add(overlays); map.setFitView(overlays, false, [50,50,50,50]);
              const heading = document.createElement("strong");
              const distance = Number(route.distance), time = Number(route.time);
              heading.textContent = (mode === "driving" ? "驾车 / Driving" : "步行 / Walking") + (Number.isFinite(distance) ? ` · ${(distance/1000).toFixed(1)} km` : "") + (Number.isFinite(time) ? ` · ${Math.ceil(time/60)} min` : "");
              const list = document.createElement("ol");
              for (const step of route.steps) {
                const item = document.createElement("li"); item.textContent = step.instruction || "继续前行 / Continue"; list.append(item);
              }
              panel.replaceChildren(heading,list); panel.hidden = false;
              finish(null,{distance,time});
            } catch { clear(); finish(new Error("route_failed")); }
          });
        } catch { finish(new Error("route_failed")); }
      }); } catch { finish(new Error("route_failed")); }
    });
  }
  return {search, clear};
}

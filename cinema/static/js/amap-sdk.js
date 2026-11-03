let sdkPromise;
export function loadAMap(config) {
  if (!config.enabled) return Promise.reject(new Error("not_configured"));
  if (window.AMap?.Map) return Promise.resolve(window.AMap);
  if (sdkPromise) return sdkPromise;
  window._AMapSecurityConfig = { serviceHost: location.origin + config.service_host };
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const timer = setTimeout(() => finish(new Error("load_failed")), 15000);
    let done = false;
    function finish(error) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) { sdkPromise = null; script.remove(); reject(error); }
      else resolve(window.AMap);
    }
    window.__falconsAMapReady = () => finish(window.AMap?.Map ? null : new Error("load_failed"));
    script.onerror = () => finish(new Error("load_failed"));
    script.src = "https://webapi.amap.com/maps?" + new URLSearchParams({ v: "2.0", key: config.key,
      plugin: "AMap.Geocoder", callback: "__falconsAMapReady" });
    document.head.append(script);
  });
  return sdkPromise;
}

export function toMapPosition(AMap, coords) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("conversion")), 7000);
    AMap.convertFrom([coords.longitude, coords.latitude], "gps", (status, result) => {
      clearTimeout(timer);
      const point = result?.locations?.[0];
      if (status !== "complete" || !point) return reject(new Error("conversion"));
      const position = [point.getLng(), point.getLat()];
      if (position.some((v) => !Number.isFinite(v)) || Math.abs(position[0]) > 180 || Math.abs(position[1]) > 90) return reject(new Error("conversion"));
      resolve(position);
    });
  });
}
export function addressFor(AMap, position) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 5000);
    new AMap.Geocoder({ extensions: "base" }).getAddress(position, (status, result) => {
      clearTimeout(timer);
      resolve(status === "complete" ? result?.regeocode?.addressComponent || null : null);
    });
  });
}

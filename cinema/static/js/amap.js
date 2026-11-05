// Native permission prompt first. No IP fallback masquerading as device location.
export function locateDevice() {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject(new Error("insecure"));
    if (!navigator.geolocation) return reject(new Error("unsupported"));
    navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(
      error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable")),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
  });
}

// Isolate the vendor SDK from the booking document's strict script policy.
export function createMapFrame(container, onCinema, config) {
  const frame = document.createElement("iframe");
  frame.title = "Cinema map · 高德地图";
  frame.src = "/maps/embed";
  frame.referrerPolicy = "same-origin";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
  container.replaceChildren(frame);
  const pending = new Map();
  let serial = 0, disposed = false, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const timer = setTimeout(() => readyReject(new Error("load_failed")), 20000);
  function send(data) { if (!disposed) frame.contentWindow?.postMessage({ channel:"falcons-map", ...data }, location.origin); }
  function receive(event) {
    if (disposed || event.source !== frame.contentWindow || event.origin !== location.origin || event.data?.channel !== "falcons-map") return;
    const msg = event.data;
    if (msg.type === "config-request") { send({ type:"config", config }); }
    else if (msg.type === "ready") { clearTimeout(timer); readyResolve(); }
    else if (msg.type === "error") { clearTimeout(timer); readyReject(new Error("load_failed")); }
    else if (msg.type === "cinema" && /^\d+$/.test(msg.id)) onCinema(msg.id);
    else if (pending.has(msg.id)) {
      const call = pending.get(msg.id); pending.delete(msg.id); clearTimeout(call.timer);
      if (msg.type === "converted") call.resolve({ position:msg.position, address:msg.address });
      else call.reject(new Error("conversion"));
    }
  }
  window.addEventListener("message", receive);
  return { ready,
    render(cinemas, position) { send({ type:"render", cinemas, position }); },
    focus(position, zoom=13) { send({ type:"focus", position, zoom }); },
    convert(coords) {
      return new Promise((resolve, reject) => {
        const id = ++serial;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error("conversion")); }, 14000);
        pending.set(id, { resolve, reject, timer });
        send({ type:"convert", id, position:[coords.longitude,coords.latitude] });
      });
    },
    destroy() {
      disposed = true; clearTimeout(timer); readyReject(new Error("disposed"));
      window.removeEventListener("message", receive); frame.remove();
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error("disposed")); }
      pending.clear();
    },
  };
}

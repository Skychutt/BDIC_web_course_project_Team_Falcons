const KEY = "falcons-language";
const listeners = new Set();

function readStored() {
  try {
    return localStorage.getItem(KEY) === "zh" ? "zh" : "en";
  } catch {
    return "en";
  }
}

let language = readStored();

export function getLanguage() {
  return language;
}

export function tx(en, zh) {
  return language === "zh" ? zh : en;
}

export function setLanguage(next) {
  const value = next === "zh" ? "zh" : "en";
  if (value === language) return language;
  language = value;
  try {
    localStorage.setItem(KEY, language);
  } catch {}
  if (typeof document !== "undefined") {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }
  for (const listener of [...listeners]) listener(language);
  return language;
}

export function onLanguage(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

import { mountConversation } from "./assistant.js";
import { icon } from "./ui.js";
import { getLanguage, onLanguage } from "./locale.js";

export function canShowAssistantEntry(user) {
  return !user || user.role === "CUSTOMER";
}

// One instance lives beside <main>, so page changes never discard the conversation or draft.
// Nothing is persisted in browser storage except the existing language preference.
export function createAssistantWidget(api) {
  const host = document.createElement("aside");
  host.id = "assistant-widget";
  host.className = "assistant-widget";
  host.innerHTML = `<section id="assistant-panel" class="ai-widget-panel" role="dialog" aria-modal="false" aria-labelledby="ai-widget-title" hidden></section>
    <button type="button" class="ai-launcher" aria-controls="assistant-panel" aria-expanded="false"><span class="ai-launcher-symbol" aria-hidden="true">${icon("spark")}</span><span class="ai-launcher-caption">AI</span><span class="ai-launcher-tooltip"></span><span class="ai-launcher-unread" hidden></span></button>`;
  document.body.append(host);
  const panel = host.querySelector("#assistant-panel");
  const launcher = host.querySelector(".ai-launcher");
  const tooltip = host.querySelector(".ai-launcher-tooltip");
  const unread = host.querySelector(".ai-launcher-unread");
  let opened = false, mounted = false, controller, identity = api.userId, language = getLanguage();
  let previousFocus = null;
  const compact = window.matchMedia("(max-width: 600px)");
  const background = [...document.querySelectorAll("#site-header, #main, .site-footer, .skip-link")];
  onLanguage((next) => labels(next));

  function labels(value = language) {
    language = value;
    const label = language === "zh" ? "AI 观影助手" : "AI movie assistant";
    const action = opened ? language === "zh" ? "收起助手" : "Minimize assistant" : label;
    launcher.setAttribute("aria-label", action);
    launcher.title = action;
    tooltip.textContent = label;
    if (panel.querySelector("[data-login-prompt]")) {
      panel.querySelector("#ai-widget-title").textContent = label;
      panel.querySelector("[data-login-prompt]").textContent = language === "zh" ? "请使用顾客账号登录观影助手。" : "Sign in with a customer account to use the movie assistant.";
      panel.querySelector("a").textContent = language === "zh" ? "登录" : "Sign in";
      panel.querySelector("button").ariaLabel = language === "zh" ? "收起助手" : "Minimize assistant";
    }
    host.setAttribute("lang", language === "zh" ? "zh-CN" : "en");
  }

  function accessibility() {
    const modal = opened && compact.matches;
    panel.setAttribute("aria-modal", String(modal));
    background.forEach((region) => { region.inert = modal; });
  }
  compact.addEventListener("change", accessibility);

  function close(restoreFocus = true) {
    if (!opened) return;
    opened = false;
    panel.hidden = true;
    host.classList.remove("is-open");
    document.body.classList.remove("ai-widget-open");
    launcher.setAttribute("aria-expanded", "false");
    accessibility();
    labels();
    if (restoreFocus) (previousFocus?.isConnected ? previousFocus : launcher).focus({ preventScroll: true });
  }

  function loginPrompt() {
    controller?.abort();
    identity = "guest";
    mounted = true;
    panel.innerHTML = `<header class="ai-widget-header"><div class="ai-widget-identity"><h2 id="ai-widget-title"></h2></div><button type="button" class="ai-widget-icon-button">${icon("close")}</button></header>
      <div class="ai-widget-welcome"><p data-login-prompt></p><a class="button" href="#/login?next=%23%2Fassistant"></a></div>`;
    panel.querySelector("button").onclick = () => close();
    labels();
    if (opened) panel.querySelector("a").focus();
  }

  async function mount() {
    if (api.userId === "guest") { loginPrompt(); return; }
    mounted = true;
    const active = new AbortController();
    controller = active;
    const results = document.createElement("section");
    results.className = "ai-widget-results";
    results.setAttribute("aria-live", "polite");
    results.hidden = true;
    await mountConversation({
      api, root: panel, floating: true, controller: active,
      isOpen: () => opened,
      onClose: () => close(),
      onLoginRequired: loginPrompt,
      onReply: () => { if (!opened) unread.hidden = false; },
      onRetry: () => { active.abort(); mount(); },
    }, panel, results);
    if (opened && !active.signal.aborted && panel.contains(document.activeElement) === false) {
      panel.querySelector("#ai-message")?.focus({ preventScroll: true });
    }
  }

  function open() {
    if (host.hidden || opened) return;
    previousFocus = document.activeElement;
    opened = true;
    panel.hidden = false;
    host.classList.add("is-open");
    document.body.classList.add("ai-widget-open");
    launcher.setAttribute("aria-expanded", "true");
    accessibility();
    unread.hidden = true;
    labels();
    if (!mounted) mount();
    else panel.querySelector("#ai-message")?.focus({ preventScroll: true });
  }

  launcher.addEventListener("click", () => opened ? close() : open());
  host.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened && !event.isComposing) { event.preventDefault(); close(); }
    if (event.key === "Tab" && opened && compact.matches) {
      const targets = [...panel.querySelectorAll("button:not(:disabled), a[href], input:not([type='hidden']):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])")].filter((node) => node.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  panel.addEventListener("click", (event) => {
    // Navigation leaves the conversation available in the orb; no route is loaded inside the panel.
    const link = event.target.closest("a[href^='#/']");
    if (link && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) close(false);
  });
  document.addEventListener("click", (event) => {
    const entry = event.target.closest("[data-open-assistant], a[href='#/assistant']");
    if (!entry || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    open();
  });
  labels();

  return {
    open,
    syncIdentity(user) {
      const hidden = !canShowAssistantEntry(user);
      if (identity === api.userId && host.hidden === hidden) return;
      host.hidden = hidden;
      identity = api.userId;
      controller?.abort();
      // Never retain another account's private cards, requests or draft after a login/logout.
      close(false);
      panel.replaceChildren();
      mounted = false;
      unread.hidden = true;
    },
  };
}

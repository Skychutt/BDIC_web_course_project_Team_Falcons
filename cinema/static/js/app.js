import { CinemaAPI } from "./api.js";
import { esc, icon, toast, showError, busy, notice } from "./ui.js";
import {
  renderDiscover,
  renderCinemas,
  renderFilm,
} from "./discover.js";
import { createAssistantWidget } from "./assistant-widget.js";
import { renderSeats } from "./seats.js";
import { renderAccount } from "./account.js";
import { renderTicketPage } from "./ticket-card.js";
import { renderOperations } from "./operations.js";
import { renderReviews, renderFilmReviews, renderDiscussion } from "./community.js";
import { getLanguage, onLanguage, setLanguage, tx } from "./locale.js";

const api = new CinemaAPI();
let assistantWidget;
let bootstrap,
  user,
  cleanup,
  updateCurrentLanguage,
  generation = 0;
const main = document.getElementById("main");
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: "start" });
});

function applyChrome() {
  document.documentElement.lang = getLanguage() === "zh" ? "zh-CN" : "en";
  const skip = document.querySelector(".skip-link");
  if (skip) skip.textContent = tx("Skip to content", "跳到主要内容");
  const tagline = document.getElementById("footer-tagline");
  const note = document.getElementById("footer-note");
  if (tagline) tagline.textContent = tx("Good stories deserve a big screen.", "好故事，值得一块大银幕。");
  if (note) note.textContent = tx("Beijing · Student project · Simulated payments", "北京 · 学生项目 · 模拟支付");
  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.content = tx(
      "Discover films across Beijing cinemas. Find a screening, choose your seats, and book together with Falcons Cinema.",
      "在北京各家影院发现影片。查找场次、选座，和 Falcons Cinema 一起订票。",
    );
  }
  const pending = document.querySelector("#main .page-loading");
  if (pending) {
    pending.innerHTML = `<span class="spinner"></span> ${tx("Finding your next movie night…", "正在为你寻找下一场电影…")}`;
  }
}

function pageTitle(path) {
  return (
    {
      "/discover": tx("Movies & showtimes", "影片与场次"),
      "/cinemas": tx("Cinemas", "影院"),
      "/reviews": tx("Film reviews", "影评"),
      "/account": tx("My tickets", "我的影票"),
      "/operations": tx("Workspace", "工作台"),
      "/login": tx("Sign in", "登录"),
      "/register": tx("Create account", "注册"),
    }[path] || tx("Your movie night", "你的观影之夜")
  );
}

onLanguage(() => {
  applyChrome();
  updateHeaderLanguage();
  updateCurrentLanguage?.();
});

function navigate(url) {
  if (location.hash === url) route();
  else location.hash = url;
}
async function refresh() {
  bootstrap = await api.request("/ui/bootstrap");
  user = bootstrap.user;
  api.userId = user?.id || "guest";
  assistantWidget?.syncIdentity();
}
function header() {
  const currentPath = (location.hash || "#/discover").split("?")[0];
  const routePath = currentPath.startsWith("#/reviews/") ? "#/reviews" : currentPath;
  const nav = (url) =>
    `<a href="${url}" class="${routePath === url ? "active" : ""}" ${routePath === url ? 'aria-current="page"' : ""}></a>`;
  const option = (code, label) =>
    `<button type="button" class="lang-option" data-lang="${code}">${label}</button>`;
  const siteHeader = document.getElementById("site-header");
  siteHeader.innerHTML = `
    <div class="brand-wrap">
      <a class="wordmark" href="#/discover">falcons<span>.</span></a>
      <a class="location" href="#/cinemas">${icon("pin")} <span></span></a>
    </div>
    <button type="button" class="mobile-menu-button" aria-expanded="false" aria-controls="main-nav" data-mobile-nav></button>
    <nav class="main-nav" id="main-nav">
      ${nav("#/discover")}${nav("#/cinemas")}${nav("#/reviews")}
      ${user?.role === "CUSTOMER" ? nav("#/account") : user ? nav("#/operations") : ""}
    </nav>
    <div class="header-actions">
      <div class="lang-switch" role="group">${option("zh", "中文")}${option("en", "English")}</div>
      ${user ? `<span class="user-label" title="${esc(user.display_name)}">${esc(user.display_name)}</span><button id="logout" class="button ghost"></button>`
        : `<a class="button secondary" href="#/login"><span data-sign-in-label></span> ${icon("arrow")}</a>`}
    </div>`;
  updateHeaderLanguage();
  const menuButton = siteHeader.querySelector("[data-mobile-nav]");
  const mainNav = siteHeader.querySelector("#main-nav");
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    mainNav.classList.toggle("is-open", open);
  });
  mainNav?.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuButton?.setAttribute("aria-expanded", "false");
      mainNav.classList.remove("is-open");
    });
  });
  siteHeader.querySelectorAll(".lang-option").forEach((button) => {
    button.addEventListener("click", () => setLanguage(button.dataset.lang));
  });
  siteHeader.querySelector("#logout")?.addEventListener("click", async (event) => {
    await busy(event.currentTarget, async () => {
      try {
        await api.logout();
        await refresh();
        navigate("#/discover");
        toast(tx("You have signed out.", "你已退出登录。"));
      } catch (e) {
        toast(e.userMessage || e.message, "error");
      }
    });
    updateHeaderLanguage();
  });
}

function updateHeaderLanguage() {
  const siteHeader = document.getElementById("site-header");
  const link = siteHeader.querySelector(".location");
  if (!link) return;
  siteHeader.querySelector(".wordmark").setAttribute("aria-label", tx("Falcons Cinema home", "Falcons Cinema 首页"));
  link.title = tx("View map and use my location", "查看地图并使用我的位置");
  link.querySelector("span").textContent = tx("Beijing · Map", "北京 · 地图");
  const nav = siteHeader.querySelector(".main-nav");
  nav.setAttribute("aria-label", tx("Main navigation", "主导航"));
  const labels = {
    "#/discover": pageTitle("/discover"),
    "#/cinemas": pageTitle("/cinemas"),
    "#/reviews": tx("Reviews", "影评"),
    "#/account": pageTitle("/account"),
    "#/operations": user?.role === "STAFF" ? tx("Cinema workspace", "影院工作台") : tx("Platform console", "平台控制台"),
  };
  nav.querySelectorAll("a").forEach((a) => { a.textContent = labels[a.getAttribute("href")]; });
  siteHeader.querySelector(".lang-switch").setAttribute("aria-label", tx("Language", "语言"));
  const menuButton = siteHeader.querySelector("[data-mobile-nav]");
  if (menuButton) {
    menuButton.setAttribute("aria-label", tx("Open menu", "打开菜单"));
    menuButton.textContent = tx("Menu", "菜单");
  }
  siteHeader.querySelectorAll(".lang-option").forEach((button) => {
    const active = button.dataset.lang === getLanguage();
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const signIn = siteHeader.querySelector("[data-sign-in-label]");
  if (signIn) signIn.textContent = tx("Sign in", "登录");
  const logout = siteHeader.querySelector("#logout");
  if (logout && !logout.disabled) logout.textContent = tx("Sign out", "退出");
}
function safeNext(params) {
  const next = params.get("next");
  return next?.startsWith("#/") &&
    !next.startsWith("#/login") &&
    !next.startsWith("#/register")
    ? next
    : "#/discover";
}
function renderAuth(ctx, register) {
  const { root, params } = ctx;
  const next = safeNext(params);
  let renderedLanguage;
  function render() {
    const previous = root.querySelector("form");
    // Let an already submitted login finish on its existing form.
    if (previous?.querySelector('[aria-busy="true"]')) return;
    const draft = previous ? new FormData(previous) : null;
    renderedLanguage = getLanguage();
    root.innerHTML = `<div class="auth-layout"><section class="auth-story"><a class="wordmark" href="#/discover">falcons<span>.</span></a><div><p class="eyebrow">${tx("YOUR SEAT IN THE STORY", "你的座位，你的故事")}</p><h2>${tx("A little escape.<br>A bigger screen.", "小小逃离。<br>更大的银幕。")}</h2><p>${tx("Find your film, bring your people, and make a night of it.", "找到影片，带上同伴，把这一晚过成电影之夜。")}</p></div><span class="fine-print" style="color:#c3d1c3">${tx("Beijing cinemas. One place to book.", "北京影院。一个地方订完。")}</span></section><section class="auth-form"><p class="eyebrow">${register ? tx("JOIN THE AUDIENCE", "加入观众") : tx("WELCOME BACK", "欢迎回来")}</p><h1>${register ? tx("Create your account", "创建账户") : tx("Sign in to Falcons", "登录 Falcons")}</h1><p class="muted">${register ? tx("Your next movie night starts here.", "下一场电影从这里开始。") : tx("Your seats, tickets and plans, all together.", "座位、影票和安排，都在这里。")}</p><form id="auth-form">${register ? `<label class="field"><span>${tx("Your name", "你的名字")}</span><input name="display_name" autocomplete="name" maxlength="80" required></label>` : ""}<label class="field"><span>${tx("Email address", "邮箱")}</span><input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label><label class="field"><span>${tx("Password", "密码")}</span><input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="10" maxlength="128" required>${register ? `<small>${tx("Use 10–128 characters.", "使用 10–128 个字符。")}</small>` : ""}</label><div class="form-error"></div><button class="button wide" type="submit">${register ? tx("Create account", "创建账户") : tx("Sign in", "登录")} ${icon("arrow")}</button></form>${register ? `<p class="fine-print">${tx("Your account receives a one-time ¥1,000 demo balance. This student project uses simulated payments only.", "账户会收到一次性 ¥1,000 演示余额。本学生项目只使用模拟支付。")}</p>` : ""}<p class="auth-switch">${register ? tx("Already have an account?", "已经有账户？") : tx("New to Falcons?", "第一次来 Falcons？")} <a href="#/${register ? "login" : "register"}?next=${encodeURIComponent(next)}">${register ? tx("Sign in", "登录") : tx("Create an account", "创建账户")}</a></p></section></div>`;
    const form = root.querySelector("form");
    if (draft) {
      for (const [name, value] of draft.entries()) form.elements[name].value = value;
      form.querySelector(".form-error").replaceChildren(...previous.querySelector(".form-error").childNodes);
    }
    form.onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      await busy(
        form.querySelector("[type=submit]"),
        async () => {
          const values = Object.fromEntries(new FormData(form));
          try {
            if (register) await api.action("register", "/auth/register", values);
            await api.login(values.email, values.password);
            form.reset();
            await refresh();
            navigate(next);
            toast(
              register
                ? tx("Account created. Your demo balance is ready.", "账户已创建，演示余额已到账。")
                : tx("Welcome back.", "欢迎回来。"),
            );
          } catch (e) {
            showError(form.querySelector(".form-error"), e);
          }
        },
        register ? tx("Creating account…", "正在创建账户…") : tx("Signing in…", "正在登录…"),
      );
      if (root.isConnected && renderedLanguage !== getLanguage()) render();
    };
  }
  ctx.updateLanguage = render;
  render();
}
async function route() {
  // Bookmarks and sign-in return URLs from the former assistant page still work.
  if (location.hash.split("?")[0] === "#/assistant") {
    history.replaceState(null, "", "#/discover");
    assistantWidget?.open();
  }
  const token = ++generation;
  cleanup?.();
  cleanup = null;
  updateCurrentLanguage = null;
  const hash = (location.hash || "#/discover").slice(1);
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  header();
  const view = document.createElement("div");
  view.className = "view";
  main.replaceChildren(view);
  view.innerHTML =
    `<div class="page-loading" role="status"><span class="spinner"></span> ${tx("Loading…", "加载中…")}</div>`;
  const ctx = {
    root: view,
    api,
    user,
    bootstrap,
    navigate,
    toast,
    params,
    refresh,
    route,
  };
  const guarded = path.startsWith("/account") || path.startsWith("/operations") || path.startsWith("/ticket/");
  if (guarded && !user) {
    navigate("#/login?next=" + encodeURIComponent("#" + hash));
    return;
  }
  try {
    let dispose;
    if (path === "/discover" || path === "/")
      dispose = await renderDiscover(ctx);
    else if (path === "/cinemas") dispose = await renderCinemas(ctx);
    else if (path === "/reviews") dispose = await renderReviews(ctx);
    else if (path.startsWith("/reviews/film/")) dispose = await renderFilmReviews(ctx, path.split("/")[3]);
    else if (path.startsWith("/reviews/thread/")) dispose = await renderDiscussion(ctx, path.split("/")[3]);
    else if (path.startsWith("/film/"))
      dispose = await renderFilm(ctx, path.split("/")[2]);
    else if (path.startsWith("/seats/"))
      dispose = await renderSeats(ctx, path.split("/")[2]);
    else if (path === "/account") dispose = await renderAccount(ctx);
    else if (path.startsWith("/ticket/")) dispose = renderTicketPage(ctx, path.split("/")[2]);
    else if (path === "/operations") dispose = await renderOperations(ctx);
    else if (path === "/login" || path === "/register")
      renderAuth(ctx, path === "/register");
    else
      view.innerHTML = notice(
        tx(
          "This page could not be found. Use the navigation above to continue.",
          "找不到这个页面。请用上方导航继续。",
        ),
        "error",
      );
    if (token === generation) {
      cleanup = dispose;
      const updateTitle = () => { document.title = (ctx.title || pageTitle(path)) + " · Falcons Cinema"; };
      updateTitle();
      updateCurrentLanguage = () => {
        if (ctx.updateLanguage) ctx.updateLanguage();
        else if (path === "/account" || path.startsWith("/ticket/")) { void route(); return; }
        updateTitle();
      };
    } else dispose?.();
  } catch (e) {
    if (token === generation) {
      showError(view, e);
      view.insertAdjacentHTML(
        "beforeend",
        `<button class="button ghost" id="retry-page">${tx("Try again", "再试一次")}</button>`,
      );
      view.querySelector("#retry-page").onclick = route;
    }
  }
}
window.addEventListener("hashchange", () => {
  route();
  window.scrollTo({ top: 0, behavior: "instant" });
});
async function start() {
  applyChrome();
  try {
    await api.init();
    await refresh();
    assistantWidget ||= createAssistantWidget(api);
    await route();
  } catch (e) {
    header();
    showError(main, e);
    main.insertAdjacentHTML(
      "beforeend",
      `<button class="button" id="retry-start">${tx("Reconnect", "重新连接")}</button>`,
    );
    document.getElementById("retry-start").onclick = start;
  }
}
start();

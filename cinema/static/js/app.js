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
import { renderOperations } from "./operations.js";

const api = new CinemaAPI();
let assistantWidget;
let bootstrap,
  user,
  cleanup,
  generation = 0;
const main = document.getElementById("main");
document.querySelector(".skip-link").addEventListener("click", (event) => {
  event.preventDefault();
  main.focus();
  main.scrollIntoView({ block: "start" });
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
  const routePath = (location.hash || "#/discover").split("?")[0];
  const nav = (url, label) =>
    `<a href="${url}" class="${routePath === url ? "active" : ""}" ${routePath === url ? 'aria-current="page"' : ""}>${label}</a>`;
  document.getElementById("site-header").innerHTML =
    `<div class="brand-wrap"><a class="wordmark" href="#/discover" aria-label="Falcons Cinema home">falcons<span>.</span></a><a class="location" href="#/cinemas" title="View map and use my location">${icon("pin")} Beijing · Map</a></div><nav class="main-nav" aria-label="Main navigation">${nav("#/discover", "Movies & showtimes")}${nav("#/cinemas", "Cinemas")}${user?.role === "CUSTOMER" ? nav("#/account", "My tickets") : ""}${user && user.role !== "CUSTOMER" ? nav("#/operations", user.role === "STAFF" ? "Cinema workspace" : "Platform console") : ""}</nav><div class="header-actions">${user ? `<span class="user-label" title="${esc(user.display_name)}">${esc(user.display_name)}</span><button id="logout" class="button ghost">Sign out</button>` : `<a class="button secondary" href="#/login">Sign in ${icon("arrow")}</a>`}</div>`;
  document.getElementById("logout")?.addEventListener("click", async (event) =>
    busy(event.currentTarget, async () => {
      try {
        await api.logout();
        await refresh();
        navigate("#/discover");
        toast("You have signed out.");
      } catch (e) {
        toast(e.userMessage || e.message, "error");
      }
    }),
  );
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
  root.innerHTML = `<div class="auth-layout"><section class="auth-story"><a class="wordmark" href="#/discover">falcons<span>.</span></a><div><p class="eyebrow">YOUR SEAT IN THE STORY</p><h2>A little escape.<br>A bigger screen.</h2><p>Find your film, bring your people, and make a night of it.</p></div><span class="fine-print" style="color:#c3d1c3">Beijing cinemas. One place to book.</span></section><section class="auth-form"><p class="eyebrow">${register ? "JOIN THE AUDIENCE" : "WELCOME BACK"}</p><h1>${register ? "Create your account" : "Sign in to Falcons"}</h1><p class="muted">${register ? "Your next movie night starts here." : "Your seats, tickets and plans, all together."}</p><form id="auth-form">${register ? '<label class="field"><span>Your name</span><input name="display_name" autocomplete="name" maxlength="80" required></label>' : ""}<label class="field"><span>Email address</span><input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="you@example.com"></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="${register ? "new-password" : "current-password"}" minlength="10" maxlength="128" required>${register ? "<small>Use 10–128 characters.</small>" : ""}</label><div class="form-error"></div><button class="button wide" type="submit">${register ? "Create account" : "Sign in"} ${icon("arrow")}</button></form>${register ? '<p class="fine-print">Your account receives a one-time ¥1,000 demo balance. This student project uses simulated payments only.</p>' : ""}<p class="auth-switch">${register ? "Already have an account?" : "New to Falcons?"} <a href="#/${register ? "login" : "register"}?next=${encodeURIComponent(next)}">${register ? "Sign in" : "Create an account"}</a></p></section></div>`;
  root.querySelector("form").onsubmit = async (event) => {
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
              ? "Account created. Your demo balance is ready."
              : "Welcome back.",
          );
        } catch (e) {
          showError(form.querySelector(".form-error"), e);
        }
      },
      register ? "Creating account…" : "Signing in…",
    );
  };
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
  const hash = (location.hash || "#/discover").slice(1);
  const [path, query = ""] = hash.split("?");
  const params = new URLSearchParams(query);
  header();
  const view = document.createElement("div");
  view.className = "view";
  main.replaceChildren(view);
  view.innerHTML =
    '<div class="page-loading" role="status"><span class="spinner"></span> Loading…</div>';
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
  const guarded = path.startsWith("/account") || path.startsWith("/operations");
  if (guarded && !user) {
    navigate("#/login?next=" + encodeURIComponent("#" + hash));
    return;
  }
  try {
    let dispose;
    if (path === "/discover" || path === "/")
      dispose = await renderDiscover(ctx);
    else if (path === "/cinemas") dispose = await renderCinemas(ctx);
    else if (path.startsWith("/film/"))
      dispose = await renderFilm(ctx, path.split("/")[2]);
    else if (path.startsWith("/seats/"))
      dispose = await renderSeats(ctx, path.split("/")[2]);
    else if (path === "/account") dispose = await renderAccount(ctx);
    else if (path === "/operations") dispose = await renderOperations(ctx);
    else if (path === "/login" || path === "/register")
      renderAuth(ctx, path === "/register");
    else
      view.innerHTML = notice(
        "This page could not be found. Use the navigation above to continue.",
        "error",
      );
    if (token === generation) {
      cleanup = dispose;
      document.title =
        ({
          "/discover": "Movies & showtimes",
          "/cinemas": "Cinemas",
          "/account": "My tickets",
          "/operations": "Workspace",
          "/login": "Sign in",
          "/register": "Create account",
        }[path] || "Your movie night") + " · Falcons Cinema";
    } else dispose?.();
  } catch (e) {
    if (token === generation) {
      showError(view, e);
      view.insertAdjacentHTML(
        "beforeend",
        '<button class="button ghost" id="retry-page">Try again</button>',
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
      '<button class="button" id="retry-start">Reconnect</button>',
    );
    document.getElementById("retry-start").onclick = start;
  }
}
start();

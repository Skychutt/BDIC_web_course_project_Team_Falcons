import { esc, icon, poster, empty, dateTime, busy, showError } from "./ui.js";
import { stars, starPicker, bindStars } from "./star-rating.js";
import { ratingSummary } from "./rating-distribution.js";

const number = value => Number(value || 0).toLocaleString("en-US");
const ratingCount = value => `${number(value)} ${Number(value) === 1 ? "rating" : "ratings"}`;
const filmURL = id => `#/reviews/film/${encodeURIComponent(id)}`;
const signIn = () => `#/login?next=${encodeURIComponent(location.hash)}`;
const genreNames = film => (film.genres || []).map(g => esc(g.name)).join(" · ");
const initials = name => esc([...String(name || "F").trim()][0]?.toUpperCase() || "F");
const canRemove = (ctx, item) => ctx.user && (ctx.user.id === item.author.id || ctx.user.role === "PLATFORM_ADMIN");
const authorLine = item => `<div class="review-author"><span class="review-avatar" aria-hidden="true">${initials(item.author.display_name)}</span><div><strong>${esc(item.author.display_name)}</strong><time datetime="${esc(item.created_at)}">${dateTime(item.created_at)}</time></div></div>`;
const textBody = (body, spoiler) => spoiler ? `<details class="spoiler-block"><summary>Contains spoilers · Show text</summary><p class="community-text">${esc(body)}</p></details>` : `<p class="community-text">${esc(body)}</p>`;

function participation(ctx, verb) {
  return ctx.user ? `<p class="community-hint">${verb} is available to customer accounts.</p>` : `<div class="community-signin"><p>Have something to share?</p><a class="button ghost small" href="${signIn()}">Sign in to ${verb.toLowerCase()} ${icon("arrow")}</a></div>`;
}

function pager(data, makeURL) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  if (pages === 1) return "";
  return `<nav class="community-pagination" aria-label="Page navigation">${data.page > 1 ? `<a class="button ghost small" href="${makeURL(data.page - 1)}">Previous</a>` : "<span></span>"}<span>Page ${data.page} of ${pages}</span>${data.page < pages ? `<a class="button ghost small" href="${makeURL(data.page + 1)}">Next</a>` : "<span></span>"}</nav>`;
}

export async function renderReviews(ctx) {
  const films = await ctx.api.request("/community/films");
  const count = films.reduce((n, f) => n + f.review_count + f.thread_count, 0);
  ctx.root.innerHTML = `<section class="community-page">
    <div class="reviews-hero"><div><p class="eyebrow">FALCONS · FILM COMMUNITY</p><h1>The credits roll.<br><em>The conversation stays.</em></h1><p>A great film deserves a good conversation. Find your next favourite, leave a few stars, or get into the details.</p><a href="#/reviews" class="reviews-explore">Explore the films ${icon("arrow")}</a></div><aside class="reviews-hero-note"><span class="review-quote" aria-hidden="true">“</span><p>Some stories stay with you.<br>Tell us which ones.</p>${stars(10)}<span>YOUR TAKE. YOUR STARS.</span><div class="community-counts"><strong>${films.length}<small>films to explore</small></strong><strong>${number(count)}<small>reviews & topics</small></strong></div></aside></div>
    <div class="review-section-heading"><div><p class="eyebrow">THE FILM SHELF</p><h2>Worth talking about.</h2></div><span class="community-hint">Watch it. Rate it. Talk about it.</span></div>
    <form class="review-filters" role="search"><label class="review-search">${icon("search")}<input name="q" aria-label="Search films" placeholder="Find a film to talk about…" maxlength="200"></label><label><span class="sr-only">Genre</span><select name="genre"><option value="">All genres</option>${[...new Set(films.flatMap(f => f.genres.map(g => g.name)))].sort().map(g => `<option>${esc(g)}</option>`).join("")}</select></label><label><span class="sr-only">Sort films</span><select name="sort"><option value="rating">Highest rated</option><option value="discussion">Most discussed</option><option value="title">Title A–Z</option></select></label></form>
    <p class="community-result-count" aria-live="polite"></p><div class="review-film-grid"></div>
    <div class="community-footnote"><span>${icon("spark")} A space for every perspective.</span><p>Rate the film, respect the people. Please mark spoilers so everyone can enjoy the story in their own time.</p></div>
  </section>`;
  const form = ctx.root.querySelector("form");
  function draw() {
    const input = new FormData(form), q = input.get("q").trim().toLocaleLowerCase();
    const list = films.filter(f => f.title.toLocaleLowerCase().includes(q) && (!input.get("genre") || f.genres.some(g => g.name === input.get("genre"))));
    list.sort((a, b) => input.get("sort") === "title" ? a.title.localeCompare(b.title) : input.get("sort") === "discussion" ? (b.review_count + b.thread_count) - (a.review_count + a.thread_count) : Number(b.rating.average || 0) - Number(a.rating.average || 0));
    ctx.root.querySelector(".community-result-count").textContent = `${list.length} ${list.length === 1 ? "film" : "films"} to explore`;
    ctx.root.querySelector(".review-film-grid").innerHTML = list.length ? list.map(f => `<a class="review-film-card" href="${filmURL(f.id)}"><div class="review-card-art">${poster(f)}<span class="review-card-cta">Join the conversation ${icon("arrow")}</span></div><div class="review-card-copy"><p class="review-card-genres">${genreNames(f) || "Film"} · ${f.duration_minutes} min</p><h3>${esc(f.title)}</h3><div class="review-card-rating">${stars(f.rating.average)}<strong>${f.rating.average == null ? "—" : Number(f.rating.average).toFixed(1)}</strong><span>/ 10</span></div><p class="review-card-activity">${number(f.review_count)} short reviews <span>·</span> ${number(f.thread_count)} discussions</p></div></a>`).join("") : empty("No films found", "Try another title or choose a different genre.");
  }
  form.oninput = draw;
  form.onsubmit = event => event.preventDefault();
  ctx.root.querySelector(".reviews-explore").onclick = event => { event.preventDefault(); form.scrollIntoView({ behavior: "smooth", block: "center" }); form.elements.q.focus({ preventScroll: true }); };
  draw();
}

function scorePanel() {
  return `<aside class="community-score" aria-label="Audience ratings"><p class="eyebrow">THE AUDIENCE SCORE</p><div class="community-score-content" aria-live="polite"></div></aside>`;
}

function bindScorePanel(ctx, data) {
  const score = ratingSummary(data);
  const date = score.checkedOn ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(score.checkedOn)) : "";
  let sourceNote = score.count ? "This is the average of ratings from Falcons viewers." : "Be the first to rate this film on Falcons.";
  if (data.imported_votes > 0) {
    const source = data.rating_snapshot ? "the Douban snapshot" : "the original film catalogue";
    sourceNote = `The average includes ${ratingCount(data.imported_votes)} from ${source}. Each Falcons rating counts as one more vote.`;
  }
  ctx.root.querySelector(".community-score-content").innerHTML = `
    <div class="community-score-summary">
      <div class="community-score-number">${score.average == null ? "—" : score.average.toFixed(1)}<small>/ 10</small></div>
      ${stars(score.average)}<p class="community-hint">${ratingCount(score.count)}</p>
      ${data.own_rating ? `<p class="community-your-rating">${stars(data.own_rating.stars)}<span>Your rating is included</span></p>` : ""}
    </div>
    <div class="community-distribution"><h3>Rating breakdown</h3>${score.distribution.map(row => `<div class="distribution-row" aria-label="${row.stars} stars: ${row.percent == null ? "unavailable" : row.percent.toFixed(1) + "%"}"><span>${row.stars} ★</span><span class="distribution-track" aria-hidden="true"><span style="width:${row.percent ?? 0}%"></span></span><span>${row.percent == null ? "—" : row.percent.toFixed(1) + "%"}</span></div>`).join("")}</div>
    <div class="rating-source-note"><span>${sourceNote}</span>
      ${!score.hasDistribution ? "<small>The imported ratings have no star breakdown.</small>" : ""}
      ${score.url ? `<small><a href="${esc(score.url)}" target="_blank" rel="noopener noreferrer">Douban source ↗</a> · Checked <time datetime="${esc(score.checkedOn)}">${date}</time><br>Star percentages are approximate because the snapshot uses rounded values.</small>` : ""}
    </div>`;
}

function reviewForm(ctx, data) {
  if (ctx.user?.role !== "CUSTOMER") return participation(ctx, "Rate and review");
  return `<form id="community-review-form" class="community-composer">${starPicker(data.own_rating?.stars)}<label class="field"><span>Your short review <small>optional</small></span><textarea name="body" maxlength="2000" rows="4" placeholder="What stayed with you? The performances, the ending, a single scene…">${esc(data.own_review?.body || "")}</textarea></label><div class="composer-tools"><label class="community-checkbox"><input type="checkbox" name="spoiler" ${data.own_review?.spoiler ? "checked" : ""}> Contains spoilers</label><span class="community-hint">Up to 2,000 characters</span></div><div class="form-error"></div><div class="community-actions"><button type="submit" class="button">${data.own_rating ? "Update my review" : "Save my rating"} ${icon("arrow")}</button>${data.own_review ? '<button type="button" class="community-text-button" id="remove-my-review">Remove short review</button>' : ""}</div><p class="community-hint composer-note">One rating per person. You can change your mind anytime. Five stars = 10 points.</p></form>`;
}

export async function renderFilmReviews(ctx, fid) {
  const tab = ctx.params.get("tab") === "discussions" ? "discussions" : "reviews";
  const page = ctx.params.get("page") || "1";
  const [data, list] = await Promise.all([
    ctx.api.request(`/community/films/${encodeURIComponent(fid)}`),
    ctx.api.request(`/community/films/${encodeURIComponent(fid)}/${tab === "reviews" ? "reviews" : "threads"}?page=${encodeURIComponent(page)}`),
  ]);
  const film = data.film;
  ctx.title = `${film.title} · Reviews`;
  const url = filmURL(fid);
  ctx.root.innerHTML = `<section class="community-page"><div class="breadcrumb"><a href="#/reviews">Film reviews</a>${icon("chevron")}<span>${esc(film.title)}</span></div>
    <div class="community-film-hero"><a class="community-film-poster" href="#/film/${esc(fid)}" aria-label="Film details for ${esc(film.title)}">${poster(film)}</a><div class="community-film-intro"><p class="eyebrow">A FILM. A THOUSAND PERSPECTIVES.</p><h1>${esc(film.title)}</h1><p class="community-film-meta">${film.duration_minutes} min <span>·</span> ${genreNames(film)}</p><p class="community-synopsis">${esc(film.synopsis)}</p><div class="community-actions"><a class="button ghost" href="#/discover?film_id=${esc(fid)}">Find showtimes ${icon("ticket")}</a><a class="community-text-button" href="#/film/${esc(fid)}">Film details ${icon("arrow")}</a></div></div>${scorePanel()}</div>
    <div class="community-layout"><section class="community-conversation"><nav class="community-tabs" aria-label="Film community"><a href="${url}" ${tab === "reviews" ? 'aria-current="page"' : ""}>Short reviews <span>${number(data.counts.reviews)}</span></a><a href="${url}?tab=discussions" ${tab === "discussions" ? 'aria-current="page"' : ""}>Discussions <span>${number(data.counts.threads)}</span></a></nav>
      ${tab === "reviews" ? `<div class="conversation-heading"><h2>What did you think?</h2><span>Newest first</span></div>${reviewForm(ctx, data)}<div class="community-review-list">${list.items.length ? list.items.map(item => `<article class="community-review"><div class="review-topline">${authorLine(item)}${item.stars ? stars(item.stars) : ""}</div>${textBody(item.body, item.spoiler)}${item.updated_at !== item.created_at ? '<span class="community-hint">Edited</span>' : ""}</article>`).join("") : empty("Your perspective could be the first.", "Leave a few words about this film. A short review can start a great conversation.")}</div>` : `<div class="conversation-heading"><h2>Let's talk about it.</h2><span>Newest first</span></div>${threadForm(ctx)}<div class="community-thread-list">${list.items.length ? list.items.map(t => `<a class="community-thread-row" href="#/reviews/thread/${esc(t.id)}"><div><div class="thread-tags">DISCUSSION ${t.spoiler ? '<span class="spoiler-tag">SPOILERS</span>' : ""}</div><h3>${esc(t.title)}</h3><p>${esc(t.author.display_name)} <span>·</span> ${dateTime(t.created_at)}</p></div><span class="thread-reply-count"><strong>${t.reply_count}</strong> replies</span>${icon("chevron")}</a>`).join("") : empty("A good question starts a conversation.", "Talk about the characters, share an interpretation, or ask what everyone else thought.")}</div>`}
      ${pager(list, p => `${url}?tab=${tab}&page=${p}`)}</section>
      <aside class="community-sidebar"><div class="community-sidebar-card"><span class="eyebrow">BETTER TOGETHER</span><h3>Different takes.<br>Same love for film.</h3><p>You don't need a ticket to have an opinion. Share yours, and make room for someone else's.</p><ul><li>Keep the conversation about the film.</li><li>Mark spoilers before you post.</li><li>Be thoughtful. Be kind.</li></ul></div><a class="community-booking-card" href="#/discover?film_id=${esc(fid)}">${icon("ticket")}<div><strong>See it on the big screen.</strong><span>Find a screening near you</span></div>${icon("arrow")}</a></aside></div></section>`;
  bindScorePanel(ctx, data);
  bindReviewForm(ctx, data, fid);
  bindThreadForm(ctx, fid);
}

function bindReviewForm(ctx, data, fid) {
  const form = ctx.root.querySelector("#community-review-form");
  if (!form) return;
  bindStars(form);
  form.onsubmit = event => {
    event.preventDefault();
    busy(form.querySelector('[type="submit"]'), async () => {
      try {
        const input = new FormData(form), score = Number(input.get("stars"));
        if (!score) throw new Error("Choose your stars before saving.");
        await ctx.api.request(`/community/films/${fid}/review`, { method: "PUT", body: { stars: score, body: input.get("body"), spoiler: input.has("spoiler") } });
        ctx.toast("Saved. Your rating is included in the audience score.");
        await ctx.refresh();
        if (ctx.root.isConnected) await ctx.route();
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    }, "Saving…");
  };
  form.querySelector("#remove-my-review")?.addEventListener("click", event => {
    if (!confirm("Remove your short review? Your star rating will be kept.")) return;
    busy(event.currentTarget, async () => {
      try {
        await ctx.api.request(`/community/films/${fid}/review`, { method: "DELETE" });
        ctx.toast("Short review removed. Your star rating is kept.");
        if (ctx.root.isConnected) await ctx.route();
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    });
  });
}

function threadForm(ctx) {
  if (ctx.user?.role !== "CUSTOMER") return participation(ctx, "Start a discussion");
  return `<details class="new-thread"><summary class="button ghost">${icon("spark")} Start a discussion</summary><form id="community-thread-form" class="community-composer"><label class="field"><span>Discussion title</span><input name="title" maxlength="160" required placeholder="A question, an interpretation, a scene you can't forget…"></label><label class="field"><span>Your thoughts</span><textarea name="body" rows="5" maxlength="8000" required placeholder="Start the conversation. Keep spoilers out of the title."></textarea></label><label class="community-checkbox"><input type="checkbox" name="spoiler"> Contains spoilers</label><div class="form-error"></div><button type="submit" class="button">Publish discussion ${icon("arrow")}</button></form></details>`;
}

function bindThreadForm(ctx, fid) {
  const form = ctx.root.querySelector("#community-thread-form");
  if (!form) return;
  form.onsubmit = event => {
    event.preventDefault();
    busy(form.querySelector('[type="submit"]'), async () => {
      try {
        const input = new FormData(form);
        const result = await ctx.api.action(`discussion-${fid}`, `/community/films/${fid}/threads`, { title: input.get("title"), body: input.get("body"), spoiler: input.has("spoiler") });
        if (ctx.root.isConnected) ctx.navigate(`#/reviews/thread/${result.id}`);
        ctx.toast("Your discussion is live.");
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    }, "Publishing…");
  };
}

export async function renderDiscussion(ctx, tid) {
  const data = await ctx.api.request(`/community/threads/${encodeURIComponent(tid)}?page=${encodeURIComponent(ctx.params.get("page") || "1")}`);
  const { thread, film, replies } = data;
  ctx.title = `${thread.title} · Discussion`;
  const filmLink = `${filmURL(film.id)}?tab=discussions`;
  ctx.root.innerHTML = `<section class="community-page discussion-page"><div class="breadcrumb"><a href="#/reviews">Film reviews</a>${icon("chevron")}<a href="${filmLink}">${esc(film.title)}</a>${icon("chevron")}<span>Discussion</span></div><div class="community-layout"><section><article class="discussion-main"><p class="eyebrow">THE CONVERSATION ${thread.spoiler ? '· CONTAINS SPOILERS' : ""}</p><h1>${esc(thread.title)}</h1>${authorLine(thread)}${textBody(thread.body, thread.spoiler)}${canRemove(ctx, thread) ? '<button class="community-text-button remove-post" data-kind="threads" data-id="' + esc(tid) + '">Remove discussion</button>' : ""}</article>
    ${thread.spoiler ? '<details class="spoiler-replies"><summary>Show replies · May contain spoilers</summary>' : ""}<div class="conversation-heading"><h2>${replies.total} ${replies.total === 1 ? "reply" : "replies"}</h2><span>Oldest first</span></div><div class="discussion-replies">${replies.items.length ? replies.items.map(r => `<article class="community-review">${authorLine(r)}<p class="community-text">${esc(r.body)}</p>${canRemove(ctx, r) ? `<button class="community-text-button remove-post" data-kind="replies" data-id="${esc(r.id)}">Remove reply</button>` : ""}</article>`).join("") : empty("Keep the conversation going.", "Be the first to reply with your take.")}</div>${pager(replies, p => `#/reviews/thread/${tid}?page=${p}`)}${thread.spoiler ? "</details>" : ""}
    ${ctx.user?.role === "CUSTOMER" ? '<form id="community-reply-form" class="community-composer"><label class="field"><span>Join the conversation</span><textarea name="body" maxlength="2000" required placeholder="Share a thoughtful reply…" rows="4"></textarea></label><div class="form-error"></div><button type="submit" class="button">Post reply ' + icon("arrow") + '</button></form>' : participation(ctx, "Reply")}</section>
    <aside class="community-sidebar"><a class="discussion-film-card" href="${filmLink}">${poster(film)}<p class="eyebrow">ABOUT THIS FILM</p><h3>${esc(film.title)}</h3>${stars(film.rating.average)}<p class="community-hint">All reviews & discussions ${icon("arrow")}</p></a></aside></div></section>`;
  const form = ctx.root.querySelector("#community-reply-form");
  if (form) form.onsubmit = event => {
    event.preventDefault();
    busy(form.querySelector('[type="submit"]'), async () => {
      try {
        await ctx.api.action(`reply-${tid}`, `/community/threads/${tid}/replies`, { body: new FormData(form).get("body") });
        ctx.toast("Your reply has been posted.");
        if (ctx.root.isConnected) ctx.navigate(`#/reviews/thread/${tid}?page=${Math.ceil((replies.total + 1) / replies.page_size)}`);
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    }, "Posting…");
  };
  ctx.root.querySelectorAll(".remove-post").forEach(button => button.onclick = () => {
    if (!confirm(button.dataset.kind === "threads" ? "Remove this discussion and hide its replies?" : "Remove this reply?")) return;
    busy(button, async () => {
      try {
        await ctx.api.request(`/community/${button.dataset.kind}/${button.dataset.id}`, { method: "DELETE" });
        ctx.toast("Post removed.");
        if (ctx.root.isConnected) {
          if (button.dataset.kind === "threads") ctx.navigate(filmLink);
          else ctx.navigate(`#/reviews/thread/${tid}`);
        }
      } catch (error) { ctx.toast(error.userMessage || error.message, "error"); }
    });
  });
}

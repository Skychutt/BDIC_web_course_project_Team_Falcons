import { esc, icon, poster, empty, dateTime, busy, showError, redrawLocalized, LocalizedError } from "./ui.js";
import { stars, starPicker, bindStars } from "./star-rating.js";
import { ratingSummary } from "./rating-distribution.js";
import { filmTitle, filmSynopsis, genreName } from "./film-locale.js";
import { tx } from "./locale.js";

const number = value => Number(value || 0).toLocaleString(tx("en-US", "zh-CN"));
const ratingCount = value => tx(`${number(value)} ${Number(value) === 1 ? "rating" : "ratings"}`, `${number(value)} 条评分`);
const filmURL = id => `#/reviews/film/${encodeURIComponent(id)}`;
const signIn = () => `#/login?next=${encodeURIComponent(location.hash)}`;
const genreNames = film => (film.genres || []).map(g => esc(genreName(g))).join(" · ");
const initials = name => esc([...String(name || "F").trim()][0]?.toUpperCase() || "F");
const canRemove = (ctx, item) => ctx.user && (ctx.user.id === item.author.id || ctx.user.role === "PLATFORM_ADMIN");
const authorLine = item => `<div class="review-author"><span class="review-avatar" aria-hidden="true">${initials(item.author.display_name)}</span><div><strong>${esc(item.author.display_name)}</strong><time datetime="${esc(item.created_at)}">${dateTime(item.created_at)}</time></div></div>`;
const textBody = (body, spoiler) => spoiler ? `<details class="spoiler-block"><summary>${tx("Contains spoilers · Show text", "含剧透 · 展开正文")}</summary><p class="community-text">${esc(body)}</p></details>` : `<p class="community-text">${esc(body)}</p>`;

function participation(ctx, verb) {
  return ctx.user ? `<p class="community-hint">${tx(`${verb} is available to customer accounts.`, `顾客账号可参与${verb}。`)}</p>` : `<div class="community-signin"><p>${tx("Have something to share?", "想分享你的看法？")}</p><a class="button ghost small" href="${signIn()}">${tx(`Sign in to ${verb.toLowerCase()}`, `登录后${verb}`)} ${icon("arrow")}</a></div>`;
}

function pager(data, makeURL) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  if (pages === 1) return "";
  return `<nav class="community-pagination" aria-label="${tx("Page navigation", "分页导航")}">${data.page > 1 ? `<a class="button ghost small" href="${makeURL(data.page - 1)}">${tx("Previous", "上一页")}</a>` : "<span></span>"}<span>${tx(`Page ${data.page} of ${pages}`, `第 ${data.page} / ${pages} 页`)}</span>${data.page < pages ? `<a class="button ghost small" href="${makeURL(data.page + 1)}">${tx("Next", "下一页")}</a>` : "<span></span>"}</nav>`;
}

function localizedPage(ctx, render, bind) {
  ctx.updateLanguage = () => {
    const pending = ctx.root.querySelector('[aria-busy="true"]');
    if (pending) {
      pending.addEventListener("action-finished", ctx.updateLanguage, { once: true });
      return;
    }
    redrawLocalized(ctx.root, render, bind);
  };
  ctx.updateLanguage();
}

export async function renderReviews(ctx) {
  const films = await ctx.api.request("/community/films");
  const count = films.reduce((n, f) => n + f.review_count + f.thread_count, 0);
  localizedPage(ctx, () => {
    ctx.root.innerHTML = `<section class="community-page">
      <div class="reviews-hero"><div><p class="eyebrow">${tx("FALCONS · FILM COMMUNITY", "FALCONS · 影评社区")}</p><h1>${tx("The credits roll.<br><em>The conversation stays.</em>", "影片散场。<br><em>讨论还在。</em>")}</h1><p>${tx("A great film deserves a good conversation. Find your next favourite, leave a few stars, or get into the details.", "好电影值得好好聊。找下一部喜欢的片子，留几颗星，或深入讨论。")}</p><a href="#/reviews" class="reviews-explore">${tx("Explore the films", "浏览影片")} ${icon("arrow")}</a></div><aside class="reviews-hero-note"><span class="review-quote" aria-hidden="true">“</span><p>${tx("Some stories stay with you.<br>Tell us which ones.", "有些故事会留在心里。<br>告诉我们是哪一部。")}</p>${stars(10)}<span>${tx("YOUR TAKE. YOUR STARS.", "你的看法。你的评分。")}</span><div class="community-counts"><strong>${films.length}<small>${tx("films to explore", "部影片可浏览")}</small></strong><strong>${number(count)}<small>${tx("reviews & topics", "条影评与话题")}</small></strong></div></aside></div>
      <div class="review-section-heading"><div><p class="eyebrow">${tx("THE FILM SHELF", "影片目录")}</p><h2>${tx("Worth talking about.", "值得一聊的电影")}</h2></div><span class="community-hint">${tx("Watch it. Rate it. Talk about it.", "看电影，打个分，聊几句。")}</span></div>
      <form class="review-filters" role="search"><label class="review-search">${icon("search")}<input name="q" maxlength="200" aria-label="${tx("Search films", "搜索影片")}" placeholder="${tx("Find a film to talk about…", "输入片名查找影片…")}"></label><label><span class="sr-only">${tx("Genre", "类型")}</span><select name="genre"><option value="">${tx("All genres", "全部类型")}</option>${[...new Set(films.flatMap(f => f.genres.map(g => g.name)))].sort().map(g => `<option value="${esc(g)}">${esc(genreName(g))}</option>`).join("")}</select></label><label><span class="sr-only">${tx("Sort films", "影片排序")}</span><select name="sort"><option value="rating">${tx("Highest rated", "评分最高")}</option><option value="discussion">${tx("Most discussed", "讨论最多")}</option><option value="title">${tx("Title A–Z", "按片名排序")}</option></select></label></form>
      <p class="community-result-count" aria-live="polite"></p><div class="review-film-grid"></div>
      <div class="community-footnote"><span>${icon("spark")} ${tx("A space for every perspective.", "欢迎各种看法。")}</span><p>${tx("Rate the film, respect the people. Please mark spoilers so everyone can enjoy the story in their own time.", "评价影片，尊重他人。请标注剧透，让大家都按自己的节奏看故事。")}</p></div>
    </section>`;
  }, () => {
    const form = ctx.root.querySelector("form");
    function draw() {
      const input = new FormData(form), q = input.get("q").trim().toLocaleLowerCase();
      const selectedGenre = input.get("genre");
      const list = films.filter(f => [f.title, filmTitle(f, "zh")].some(title => title.toLocaleLowerCase().includes(q))
        && (!selectedGenre || f.genres.some(g => g.name === selectedGenre)));
      list.sort((a, b) => input.get("sort") === "title" ? filmTitle(a).localeCompare(filmTitle(b), tx("en", "zh-CN")) : input.get("sort") === "discussion" ? (b.review_count + b.thread_count) - (a.review_count + a.thread_count) : Number(b.rating.average || 0) - Number(a.rating.average || 0));
      ctx.root.querySelector(".community-result-count").textContent = tx(`${list.length} ${list.length === 1 ? "film" : "films"} to explore`, `${list.length} 部影片`);
      ctx.root.querySelector(".review-film-grid").innerHTML = list.length ? list.map(f => `<a class="review-film-card" href="${filmURL(f.id)}"><div class="review-card-art">${poster(f)}<span class="review-card-cta">${tx("Join the conversation", "参与讨论")} ${icon("arrow")}</span></div><div class="review-card-copy"><p class="review-card-genres">${genreNames(f) || tx("Film", "电影")} · ${f.duration_minutes} ${tx("min", "分钟")}</p><h3>${esc(filmTitle(f))}</h3><div class="review-card-rating">${stars(f.rating.average)}<strong>${f.rating.average == null ? "—" : Number(f.rating.average).toFixed(1)}</strong><span>/ 10</span></div><p class="review-card-activity">${number(f.review_count)} ${tx("short reviews", "条短评")} <span>·</span> ${number(f.thread_count)} ${tx("discussions", "个讨论")}</p></div></a>`).join("") : empty(tx("No films found", "没有找到影片"), tx("Try another title or choose a different genre.", "请尝试其他片名或类型。"));
    }
    form.oninput = draw;
    form.onsubmit = event => event.preventDefault();
    ctx.root.querySelector(".reviews-explore").onclick = event => { event.preventDefault(); form.scrollIntoView({ behavior: "smooth", block: "center" }); form.elements.q.focus({ preventScroll: true }); };
    draw();
  });
}

function scorePanel() {
  return `<aside class="community-score" aria-label="${tx("Audience ratings", "观众评分")}"><p class="eyebrow">${tx("THE AUDIENCE SCORE", "观众评分")}</p><div class="community-score-content" aria-live="polite"></div></aside>`;
}

function bindScorePanel(ctx, data) {
  const score = ratingSummary(data);
  const date = score.checkedOn ? new Intl.DateTimeFormat(tx("en-GB", "zh-CN"), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(score.checkedOn)) : "";
  let sourceNote = score.count ? tx("This is the average of ratings from Falcons viewers.", "此分数为 Falcons 观众的平均评分。") : tx("Be the first to rate this film on Falcons.", "成为第一位在 Falcons 为本片打分的观众。");
  if (data.imported_votes > 0) {
    const source = data.rating_snapshot ? tx("the Douban snapshot", "豆瓣评分快照") : tx("the original film catalogue", "原始片库");
    sourceNote = tx(`The average includes ${ratingCount(data.imported_votes)} from ${source}. Each Falcons rating counts as one more vote.`, `平均分包含来自${source}的 ${ratingCount(data.imported_votes)}。每位 Falcons 观众的评分各计一票。`);
  }
  ctx.root.querySelector(".community-score-content").innerHTML = `
    <div class="community-score-summary">
      <div class="community-score-number">${score.average == null ? "—" : score.average.toFixed(1)}<small>/ 10</small></div>
      ${stars(score.average)}<p class="community-hint">${ratingCount(score.count)}</p>
      ${data.own_rating ? `<p class="community-your-rating">${stars(data.own_rating.stars)}<span>${tx("Your rating is included", "已计入你的评分")}</span></p>` : ""}
    </div>
    <div class="community-distribution"><h3>${tx("Rating breakdown", "星级分布")}</h3>${score.distribution.map(row => `<div class="distribution-row" aria-label="${tx(`${row.stars} stars`, `${row.stars} 星`)} · ${row.percent == null ? tx("unavailable", "暂无数据") : row.percent.toFixed(1) + "%"}"><span>${row.stars} ★</span><span class="distribution-track" aria-hidden="true"><span style="width:${row.percent ?? 0}%"></span></span><span>${row.percent == null ? "—" : row.percent.toFixed(1) + "%"}</span></div>`).join("")}</div>
    <div class="rating-source-note"><span>${sourceNote}</span>
      ${!score.hasDistribution ? `<small>${tx("The imported ratings have no star breakdown.", "导入的评分未提供星级分布。")}</small>` : ""}
      ${score.url ? `<small><a href="${esc(score.url)}" target="_blank" rel="noopener noreferrer">${tx("Douban source ↗", "豆瓣来源 ↗")}</a> · ${tx("Checked", "更新于")} <time datetime="${esc(score.checkedOn)}">${date}</time><br>${tx("Star percentages are approximate because the snapshot uses rounded values.", "快照数据经过四舍五入，各星级占比为近似值。")}</small>` : ""}
    </div>`;
}

function reviewForm(ctx, data) {
  if (ctx.user?.role !== "CUSTOMER") return participation(ctx, tx("Rate and review", "评分和写短评"));
  return `<form id="community-review-form" class="community-composer">${starPicker(data.own_rating?.stars)}<label class="field"><span>${tx("Your short review", "我的短评")} <small>${tx("optional", "选填")}</small></span><textarea name="body" maxlength="2000" rows="4" placeholder="${tx("What stayed with you? The performances, the ending, a single scene…", "表演、结局，还是某个镜头让你印象深刻？")}">${esc(data.own_review?.body || "")}</textarea></label><div class="composer-tools"><label class="community-checkbox"><input type="checkbox" name="spoiler" ${data.own_review?.spoiler ? "checked" : ""}> ${tx("Contains spoilers", "含剧透")}</label><span class="community-hint">${tx("Up to 2,000 characters", "最多 2,000 字")}</span></div><div class="form-error"></div><div class="community-actions"><button type="submit" class="button">${data.own_rating ? tx("Update my review", "更新我的评价") : tx("Save my rating", "保存评分")} ${icon("arrow")}</button>${data.own_review ? `<button type="button" class="community-text-button" id="remove-my-review">${tx("Remove short review", "删除短评")}</button>` : ""}</div><p class="community-hint composer-note">${tx("One rating per person. You can change your mind anytime. Five stars = 10 points.", "每人可为本片打一次分，之后可随时修改。五星对应十分。")}</p></form>`;
}

export async function renderFilmReviews(ctx, fid) {
  const tab = ctx.params.get("tab") === "discussions" ? "discussions" : "reviews";
  const page = ctx.params.get("page") || "1";
  const [data, list] = await Promise.all([
    ctx.api.request(`/community/films/${encodeURIComponent(fid)}`),
    ctx.api.request(`/community/films/${encodeURIComponent(fid)}/${tab === "reviews" ? "reviews" : "threads"}?page=${encodeURIComponent(page)}`),
  ]);
  const film = data.film;
  const url = filmURL(fid);
  localizedPage(ctx, () => {
    ctx.root.innerHTML = `<section class="community-page"><div class="breadcrumb"><a href="#/reviews">${tx("Film reviews", "影评")}</a>${icon("chevron")}<span data-film-title></span></div>
      <div class="community-film-hero"><a class="community-film-poster" href="#/film/${esc(fid)}"></a><div class="community-film-intro"><p class="eyebrow">${tx("A FILM. A THOUSAND PERSPECTIVES.", "一部电影，千种视角")}</p><h1 data-film-title></h1><p class="community-film-meta"></p><p class="community-synopsis"></p><div class="community-actions"><a class="button ghost" href="#/discover?film_id=${esc(fid)}">${tx("Find showtimes", "查找场次")} ${icon("ticket")}</a><a class="community-text-button" href="#/film/${esc(fid)}">${tx("Film details", "影片详情")} ${icon("arrow")}</a></div></div>${scorePanel()}</div>
      <div class="community-layout"><section class="community-conversation"><nav class="community-tabs" aria-label="${tx("Film community", "影评社区")}"><a href="${url}" ${tab === "reviews" ? 'aria-current="page"' : ""}>${tx("Short reviews", "短评")} <span>${number(data.counts.reviews)}</span></a><a href="${url}?tab=discussions" ${tab === "discussions" ? 'aria-current="page"' : ""}>${tx("Discussions", "讨论")} <span>${number(data.counts.threads)}</span></a></nav>
        ${tab === "reviews" ? `<div class="conversation-heading"><h2>${tx("What did you think?", "你觉得这部电影怎么样？")}</h2><span>${tx("Newest first", "最新在前")}</span></div>${reviewForm(ctx, data)}<div class="community-review-list">${list.items.length ? list.items.map(item => `<article class="community-review"><div class="review-topline">${authorLine(item)}${item.stars ? stars(item.stars) : ""}</div>${textBody(item.body, item.spoiler)}${item.updated_at !== item.created_at ? `<span class="community-hint">${tx("Edited", "已编辑")}</span>` : ""}</article>`).join("") : empty(tx("Your perspective could be the first.", "还没有短评"), tx("Leave a few words about this film. A short review can start a great conversation.", "写下你的感受，成为第一个点评这部影片的人。"))}</div>` : `<div class="conversation-heading"><h2>${tx("Let's talk about it.", "一起聊聊这部电影")}</h2><span>${tx("Newest first", "最新在前")}</span></div>${threadForm(ctx)}<div class="community-thread-list">${list.items.length ? list.items.map(t => `<a class="community-thread-row" href="#/reviews/thread/${esc(t.id)}"><div><div class="thread-tags">${tx("DISCUSSION", "讨论")} ${t.spoiler ? `<span class="spoiler-tag">${tx("SPOILERS", "剧透")}</span>` : ""}</div><h3>${esc(t.title)}</h3><p>${esc(t.author.display_name)} <span>·</span> ${dateTime(t.created_at)}</p></div><span class="thread-reply-count"><strong>${t.reply_count}</strong> ${tx("replies", "条回复")}</span>${icon("chevron")}</a>`).join("") : empty(tx("A good question starts a conversation.", "还没有讨论"), tx("Talk about the characters, share an interpretation, or ask what everyone else thought.", "聊聊角色、分享你的解读，或问问大家怎么看。"))}</div>`}
        ${pager(list, p => `${url}?tab=${tab}&page=${p}`)}</section>
        <aside class="community-sidebar"><div class="community-sidebar-card"><span class="eyebrow">${tx("BETTER TOGETHER", "观影同好")}</span><h3>${tx("Different takes.", "各有见解，")}<br>${tx("Same love for film.", "同样爱电影。")}</h3><p>${tx("You don't need a ticket to have an opinion. Share yours, and make room for someone else's.", "无需购票也能发言。分享你的想法，也听听不同的声音。")}</p><ul><li>${tx("Keep the conversation about the film.", "围绕影片展开讨论。")}</li><li>${tx("Mark spoilers before you post.", "发布前请标记剧透。")}</li><li>${tx("Be thoughtful. Be kind.", "真诚交流，友善待人。")}</li></ul></div><a class="community-booking-card" href="#/discover?film_id=${esc(fid)}">${icon("ticket")}<div><strong>${tx("See it on the big screen.", "去大银幕看这部电影")}</strong><span>${tx("Find a screening near you", "查找附近场次")}</span></div>${icon("arrow")}</a></aside></div></section>`;
  }, () => {
    const title = filmTitle(film);
    ctx.title = tx(`${title} · Reviews`, `${title} · 影评`);
    ctx.root.querySelectorAll("[data-film-title]").forEach(node => { node.textContent = title; });
    const artwork = ctx.root.querySelector(".community-film-poster");
    artwork.setAttribute("aria-label", tx(`Film details for ${title}`, `《${title}》的影片详情`));
    artwork.innerHTML = poster(film);
    ctx.root.querySelector(".community-film-meta").innerHTML = `${esc(film.duration_minutes)} ${tx("min", "分钟")} <span>·</span> ${genreNames(film)}`;
    ctx.root.querySelector(".community-synopsis").textContent = filmSynopsis(film);
    bindScorePanel(ctx, data);
    bindReviewForm(ctx, data, fid);
    bindThreadForm(ctx, fid);
  });
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
        if (!score) throw new LocalizedError("Choose your stars before saving.", "请先选择星级再保存。");
        await ctx.api.request(`/community/films/${fid}/review`, { method: "PUT", body: { stars: score, body: input.get("body"), spoiler: input.has("spoiler") } });
        ctx.toast(tx("Saved. Your rating is included in the audience score.", "已保存，你的评分已计入观众评分。"));
        await ctx.refresh();
        if (ctx.root.isConnected) await ctx.route();
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    }, tx("Saving…", "保存中…"));
  };
  form.querySelector("#remove-my-review")?.addEventListener("click", event => {
    if (!confirm(tx("Remove your short review? Your star rating will be kept.", "确定删除这条短评吗？你的星级评分会保留。"))) return;
    busy(event.currentTarget, async () => {
      try {
        await ctx.api.request(`/community/films/${fid}/review`, { method: "DELETE" });
        ctx.toast(tx("Short review removed. Your star rating is kept.", "短评已删除，星级评分已保留。"));
        if (ctx.root.isConnected) await ctx.route();
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    });
  });
}

function threadForm(ctx) {
  if (ctx.user?.role !== "CUSTOMER") return participation(ctx, tx("Start a discussion", "发起讨论"));
  return `<details class="new-thread"><summary class="button ghost">${icon("spark")} ${tx("Start a discussion", "发起讨论")}</summary><form id="community-thread-form" class="community-composer"><label class="field"><span>${tx("Discussion title", "讨论标题")}</span><input name="title" maxlength="160" required placeholder="${tx("A question, an interpretation, a scene you can't forget…", "一个疑问、一种解读，或一个难忘的镜头……")}"></label><label class="field"><span>${tx("Your thoughts", "你的想法")}</span><textarea name="body" rows="5" maxlength="8000" required placeholder="${tx("Start the conversation. Keep spoilers out of the title.", "写下讨论内容，标题中请勿剧透。")}"></textarea></label><label class="community-checkbox"><input type="checkbox" name="spoiler"> ${tx("Contains spoilers", "含剧透")}</label><div class="form-error"></div><button type="submit" class="button">${tx("Publish discussion", "发布讨论")} ${icon("arrow")}</button></form></details>`;
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
        ctx.toast(tx("Your discussion is live.", "讨论已发布。"));
      } catch (error) { showError(form.querySelector(".form-error"), error); }
    }, tx("Publishing…", "发布中…"));
  };
}

export async function renderDiscussion(ctx, tid) {
  const data = await ctx.api.request(`/community/threads/${encodeURIComponent(tid)}?page=${encodeURIComponent(ctx.params.get("page") || "1")}`);
  const { thread, film, replies } = data;

  const filmLink = `${filmURL(film.id)}?tab=discussions`;
  localizedPage(ctx, () => {
    ctx.root.innerHTML = `<section class="community-page discussion-page"><div class="breadcrumb"><a href="#/reviews">${tx("Film reviews", "影评")}</a>${icon("chevron")}<a href="${filmLink}" data-film-title></a>${icon("chevron")}<span>${tx("Discussion", "讨论")}</span></div><div class="community-layout"><section><article class="discussion-main"><p class="eyebrow">${tx("THE CONVERSATION", "讨论正文")} ${thread.spoiler ? tx("· CONTAINS SPOILERS", "· 含剧透") : ""}</p><h1>${esc(thread.title)}</h1>${authorLine(thread)}${textBody(thread.body, thread.spoiler)}${canRemove(ctx, thread) ? `<button class="community-text-button remove-post" data-kind="threads" data-id="${esc(tid)}">${tx("Remove discussion", "删除讨论")}</button>` : ""}</article>
      ${thread.spoiler ? `<details class="spoiler-replies"><summary>${tx("Show replies · May contain spoilers", "展开回复 · 可能含有剧透")}</summary>` : ""}<div class="conversation-heading"><h2>${replies.total} ${tx(replies.total === 1 ? "reply" : "replies", "条回复")}</h2><span>${tx("Oldest first", "最早在前")}</span></div><div class="discussion-replies">${replies.items.length ? replies.items.map(r => `<article class="community-review">${authorLine(r)}<p class="community-text">${esc(r.body)}</p>${canRemove(ctx, r) ? `<button class="community-text-button remove-post" data-kind="replies" data-id="${esc(r.id)}">${tx("Remove reply", "删除回复")}</button>` : ""}</article>`).join("") : empty(tx("Keep the conversation going.", "还没有回复"), tx("Be the first to reply with your take.", "说说你的看法，写下第一条回复。"))}</div>${pager(replies, p => `#/reviews/thread/${tid}?page=${p}`)}${thread.spoiler ? "</details>" : ""}
      ${ctx.user?.role === "CUSTOMER" ? `<form id="community-reply-form" class="community-composer"><label class="field"><span>${tx("Join the conversation", "参与讨论")}</span><textarea name="body" maxlength="2000" required placeholder="${tx("Share a thoughtful reply…", "写下你的回复……")}" rows="4"></textarea></label><div class="form-error"></div><button type="submit" class="button">${tx("Post reply", "发布回复")} ${icon("arrow")}</button></form>` : participation(ctx, tx("Reply", "回复"))}</section>
      <aside class="community-sidebar"><a class="discussion-film-card" href="${filmLink}"><div data-film-poster></div><p class="eyebrow">${tx("ABOUT THIS FILM", "关于本片")}</p><h3 data-film-title></h3>${stars(film.rating.average)}<p class="community-hint">${tx("All reviews & discussions", "全部短评与讨论")} ${icon("arrow")}</p></a></aside></div></section>`;
  }, () => {
    ctx.title = tx(`${thread.title} · Discussion`, `${thread.title} · 讨论`);
    ctx.root.querySelectorAll("[data-film-title]").forEach(node => { node.textContent = filmTitle(film); });
    ctx.root.querySelector("[data-film-poster]").innerHTML = poster(film);
    const form = ctx.root.querySelector("#community-reply-form");
    if (form) form.onsubmit = event => {
      event.preventDefault();
      busy(form.querySelector('[type="submit"]'), async () => {
        try {
          await ctx.api.action(`reply-${tid}`, `/community/threads/${tid}/replies`, { body: new FormData(form).get("body") });
          ctx.toast(tx("Your reply has been posted.", "回复已发布。"));
          if (ctx.root.isConnected) ctx.navigate(`#/reviews/thread/${tid}?page=${Math.ceil((replies.total + 1) / replies.page_size)}`);
        } catch (error) { showError(form.querySelector(".form-error"), error); }
      }, tx("Posting…", "发布中…"));
    };
    ctx.root.querySelectorAll(".remove-post").forEach(button => button.onclick = () => {
      if (!confirm(button.dataset.kind === "threads" ? tx("Remove this discussion and hide its replies?", "确定删除此讨论并隐藏所有回复吗？") : tx("Remove this reply?", "确定删除此回复吗？"))) return;
      busy(button, async () => {
        try {
          await ctx.api.request(`/community/${button.dataset.kind}/${button.dataset.id}`, { method: "DELETE" });
          ctx.toast(tx("Post removed.", "内容已删除。"));
          if (ctx.root.isConnected) {
            if (button.dataset.kind === "threads") ctx.navigate(filmLink);
            else ctx.navigate(`#/reviews/thread/${tid}`);
          }
        } catch (error) { ctx.toast(error.userMessage || error.message, "error"); }
      });
    });
  });
}

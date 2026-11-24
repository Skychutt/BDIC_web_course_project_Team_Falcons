// Run against the Flask shell. All API calls use fixtures, including the staff and admin views.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.CINEMA_BASE_URL || "http://127.0.0.1:5002";
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL });
const page = await browser.newPage();
page.setDefaultTimeout(6000);
const errors = [];
page.on("pageerror", err => errors.push(err.message));
const genre = { id: "1", name: "Adventure" };
const film = { id: "2", title: "Interstellar", synopsis: "", genres: [genre], duration_minutes: 169,
  review_count: 1, thread_count: 1, rating: { average: 8, count: 1 } };
const cinema = { id: "3", name: "万达影城(CBD万达广场店)", address: "北京市朝阳区建国路93号万达广场B座3楼",
  brand: "万达影城", district_id: "4", district_name: "Chaoyang", is_active: true, manager_user_id: "7" };
const otherCinema = { ...cinema, id: "12", name: "北苑店", manager_user_id: null };
const emptyCinema = { ...otherCinema, id: "13", name: "西山店" };
const screen = { id: "5", name: "Screen 1", screen_type: "STANDARD", layouts: [{ id: "6", version_no: 1, row_count: 10 }] };
const employee = { id: "7", display_name: "小李", role: "STAFF", staff_cinema_id: cinema.id, is_manager: true };
let user = employee;
const thread = { id: "9", title: "My original title", body: "我的观后感", spoiler: true, author: employee, created_at: "2026-01-01T12:00:00Z" };
const list = items => ({ items, total: items.length, page: 1, page_size: 20 });
const moderation = { page: 1, has_next: false, items: [
  { id: "11", kind: "reply", thread_title: thread.title, film_title: film.title,
    body: "A different ending", display_name: "Anna", created_at: thread.created_at },
  { id: thread.id, kind: "thread", thread_title: thread.title, film_title: film.title,
    body: thread.body, display_name: employee.display_name, created_at: thread.created_at },
] };
const fixtures = {
  "/counter/screenings": [{ id: "8", film_title: film.title, screen_name: screen.name, starts_at: "2099-01-01T12:00:00Z" }],
  "/auth/csrf": { csrf_token: "test" },
  "/admin/cinemas": [cinema, otherCinema, emptyCinema],
  "/admin/staff": [
    { id: "20", display_name: "Anna", email_normalized: "anna@example.test", staff_cinema_id: cinema.id },
    { id: "21", display_name: "小李", email_normalized: "li@example.test", staff_cinema_id: otherCinema.id },
    employee,
  ],
  "/admin/films": list([film]),
  "/staff/screens": [screen], "/staff/screenings": list([{ id: "8", film_id: film.id, screen_id: screen.id,
    film_title: film.title, screen_name: screen.name, status: "PUBLISHED", starts_at: "2099-01-01T12:00:00Z", ends_at: "2099-01-01T15:00:00Z", revision_no: 1 }]),
  "/staff/bookings": list([]), "/staff/refunds": list([]), "/maps/config": { enabled: false },
  "/cinemas/3/turnover": { cinema_id: "3", net_settled_minor: 12500, from: "2026-01-01", to: "2026-02-01", as_of: "2026-02-01" },
  "/community/films": [film], "/community/films/2": { film, counts: { reviews: 0, threads: 1 } },
  "/community/films/2/reviews": list([]), "/community/films/2/threads": list([thread]),
  "/community/threads/9": { thread, film, replies: list([]) },
  "/community/moderation/posts": moderation,
};
const requests = [];
await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname.slice(4);
  requests.push([route.request().method(), path]);
  if (route.request().method() === "DELETE" && ["/community/replies/11", "/community/threads/9"].includes(path)) {
    moderation.items = moderation.items.filter(post => post.id !== path.split("/").at(-1));
    return route.fulfill({ json: { data: { removed: true } } });
  }
  const data = path === "/ui/bootstrap" ? { user, films: [film], genres: [genre], cinemas: [cinema],
    districts: [{ id: "4", name: "Chaoyang", admin_code: "110105" }], available_dates: [] } : fixtures[path];
  if (data === undefined) errors.push("Unexpected request " + path);
  await route.fulfill({ json: { data } });
});
const lang = code => page.locator(`#site-header [data-lang="${code}"]`).click();
const tab = id => page.locator(`[data-tab="${id}"]`).click();
const main = page.locator("#main");
const dialog = page.getByRole("dialog");
const text = async (area, label) => { await area.getByText(label, { exact: true }).first().waitFor(); };
async function openAs(person, path) {
  user = person;
  await page.goto("about:blank");
  await page.goto(base + "/#" + path);
}
try {
  await page.goto(base + "/#/operations");
  await text(main, "Screenings");
  assert.equal(await main.locator('[data-tab="community"]').count(), 0);
  const readCount = requests.length;
  await lang("zh");
  await text(main, "影院工作台");
  await text(main, "星际穿越");
  await text(main, "1 号厅");
  assert.equal(requests.length, readCount);
  await page.locator('[data-act="publish"]').click();
  await text(dialog, "发布放映场次");
  assert.equal(await dialog.locator('[name="film_id"] option:checked').textContent(), "星际穿越");
  await dialog.locator("[data-close]").click();
  await tab("layouts");
  await text(main, "影厅与座位布局");
  await tab("counter");
  const email = main.locator('[name="email"]');
  await email.fill("viewer@cinema.test");
  for (const code of ["en", "zh"]) {
    await lang(code);
    await text(main, code === "zh" ? "发送邮箱验证码" : "Email verification code");
    assert.equal(await email.inputValue(), "viewer@cinema.test");
  }
  await tab("bookings");
  await text(main, "本店暂无订单");
  await tab("refunds");
  await text(main, "暂无退款");
  await tab("turnover");
  await main.locator("[data-turnover] button").click();
  await text(main, "结算净额");
  const reportCount = requests.length;
  await lang("en");
  await text(main, "Net settlement");
  assert.equal(requests.length, reportCount);

  const admin = { id: "10", display_name: "Admin", role: "PLATFORM_ADMIN", staff_cinema_id: null, is_manager: false };
  await openAs(admin, "/discover");
  await text(main, "Wanda Cinema (CBD Wanda Plaza)");
  assert.match(page.url(), /#\/operations\?tab=cinemas$/);
  assert.deepEqual(await page.locator("[data-operations-nav] button").evaluateAll(buttons => buttons.map(b => b.dataset.tab)),
    ["cinemas", "films", "staff", "turnover", "community"]);
  assert.deepEqual(await page.locator(".wordmark").evaluateAll(links => links.map(a => a.hash)), ["#/operations", "#/operations"]);
  await page.getByRole("link", { name: "Platform console", exact: true }).waitFor();
  await lang("zh");
  await page.getByRole("link", { name: "平台控制台", exact: true }).waitFor();
  await text(main, "平台管理");
  await text(main, "朝阳区");
  await tab("community");
  await text(main, "讨论与回复");
  await main.getByText("查看回复", { exact: true }).click();
  await text(main, "A different ending");
  await lang("en");
  page.once("dialog", prompt => prompt.dismiss());
  await main.getByRole("button", { name: "Remove reply" }).click();
  assert.equal(moderation.items.length, 2);
  page.once("dialog", prompt => prompt.accept());
  await main.getByRole("button", { name: "Remove reply" }).click();
  await main.getByRole("button", { name: "Remove reply" }).waitFor({ state: "detached" });
  page.once("dialog", prompt => prompt.accept());
  await main.getByRole("button", { name: "Remove discussion" }).click();
  await text(main, "No discussions or replies");
  await lang("zh");
  await tab("staff");
  await text(main, "调店");
  const branch = main.getByRole("region", { name: cinema.name, exact: true });
  assert.deepEqual(await branch.locator("tbody tr strong").allTextContents(), ["小李", "Anna"]);
  await text(branch.getByRole("row").filter({ hasText: "小李" }), "经理");
  const filter = main.getByRole("combobox", { name: "按影院筛选" });
  await filter.selectOption(otherCinema.id);
  assert.equal(await branch.isVisible(), false);
  assert.equal(await main.getByRole("region", { name: otherCinema.name }).getByRole("button", { name: "调店" }).count(), 1);
  await main.getByRole("button", { name: "＋ 创建员工账号" }).click();
  assert.equal(await dialog.getByLabel("所属影院").inputValue(), otherCinema.id);
  await dialog.locator("[data-close]").click();
  await lang("en");
  assert.equal(await main.getByLabel("Filter by cinema").inputValue(), otherCinema.id);
  assert.equal(await main.locator(".staff-roster:visible").count(), 1);
  await lang("zh");
  await filter.selectOption(emptyCinema.id);
  await text(main.getByRole("region", { name: emptyCinema.name }), "这家影院暂无员工。");
  await filter.selectOption("");
  assert.equal(await main.locator(".staff-roster:visible").count(), 3);
  await tab("films");
  await text(main, "星际穿越");
  await text(main, "冒险");
  await main.locator('[data-act="create-film"]').click();
  await text(dialog, "剧情简介");
  await dialog.locator("[data-close]").click();

  for (const path of ["/cinemas", "/reviews/film/2", "/seats/8", "/account", "/ticket/example"]) {
    await openAs(admin, path);
    await text(main, "平台管理");
    assert.match(page.url(), /#\/operations\?tab=cinemas$/);
  }
  await openAs(admin, "/operations?tab=films");
  await text(main, "星际穿越");
  assert.equal(await main.locator('[data-tab="films"]').getAttribute("aria-pressed"), "true");

  await openAs({ ...employee, role: "CUSTOMER" }, "/reviews");
  await text(main, "值得一聊的电影");
  const search = main.locator('[name="q"]');
  await search.fill("星际");
  await lang("en");
  assert.equal(await search.inputValue(), "星际");
  await text(main, "Interstellar");
  await main.locator(".review-film-card").click();
  await main.locator('[aria-label="4 stars"]').check();
  const draft = main.locator("textarea[name=body]");
  await draft.fill("My unfinished review");
  await lang("zh");
  await text(main, "星级分布");
  assert.equal(await draft.inputValue(), "My unfinished review");
  assert.ok(await main.getByRole("radio", { name: "4 星" }).isChecked());
  await main.locator('a[href$="tab=discussions"]').first().click();
  await text(main, "My original title");
  await main.locator(".community-thread-row").click();
  await text(main, "删除讨论");
  await main.locator("textarea").fill("我的回复草稿");
  await lang("en");
  await text(main, "Remove discussion");
  assert.equal(await main.locator("textarea").inputValue(), "我的回复草稿");
  await page.locator('#site-header a[href="#/cinemas"]').first().click();
  await text(main, "Wanda Cinema (CBD Wanda Plaza)");
  await lang("zh");
  await text(main, cinema.name);
  await text(main.locator(".cinema-cover-label"), "朝阳区");
  assert.deepEqual(errors, []);
  console.log("PASS staff and admin tabs, dialogs, report, community views and drafts in both languages");
} finally {
  await browser.close();
}

// Boot the real app against isolated synthetic local storage. No customer state or live APIs.
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(import.meta.dirname, "..");
const files = new Map(await Promise.all(["index.html", "app.js", "app.css", "tailwind.css", "logo-header.png"].map(async (name) => ["/" + name, await readFile(path.join(root, "dist", name))])));
const server = createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = files.get(pathname === "/" ? "/index.html" : pathname);
  if (!file) { res.writeHead(404); res.end(); return; }
  res.setHeader("Content-Type", pathname.endsWith(".js") ? "text/javascript" : pathname.endsWith(".css") ? "text/css" : pathname.endsWith('.png') ? 'image/png' : "text/html");
  res.end(file);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = "http://127.0.0.1:" + server.address().port;
const titles = ["サムネ×小林さん", "【チャンネル閉じましょう】諦めかけたプロデュース…YouTube運用代行の苦悩", "なぜ日本は見た目の国になったのか｜ダウンタイムに仕掛けられた欲しくさせる設計"];
const projects = titles.map((title, i) => ({
  id: "fixture-" + i, name: title, channel: "マナブ", format: "talk", createdAt: 100 + i, updatedAt: 100 + i,
  meta: { shootDate: "2026-10-18", note: "保持する合成メモ", client: "合成クライアント" },
  theme: { main: "#1F2430", accent: "#E63946" }, rows: [],
  plans: [{ id: "plan-" + i, title, thumbText: "見た目に支配される日本", thumbText2: "その美しさ、誰が決めた？", note: "保存済みの企画意図", refs: Array.from({ length: 5 }, (_, n) => ({ vid: "fixture" + n, url: "https://youtu.be/fixture" + n, title: ["港区女子のパラドックス", "全員見るべきダウンタイム", "美容整形の危険地帯", "ダウンタイムの元ネタ", "日本の闇"][n], duration: "20:39", unknown: "keep-reference" })), unknown: "keep-plan" }],
  assets: [], files: [], review: { versions: [], comments: [] }, unknown: "keep-project"
}));
const extra = { ...projects[0], id: "other-channel", name: "別チャンネルの企画", channel: "宇宙への挑戦者" };
const all = [...projects, extra];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--no-sandbox"] });
const output = process.env.PLAN_QA_OUTPUT || "/private/tmp/monogatari-plan-qa";
await mkdir(output, { recursive: true });
try {
  for (const width of [320, 390, 640, 641, 1024, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: "ja-JP", isMobile: width <= 640, hasTouch: width <= 640, serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.error("UI error:", e.message); });
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith(origin)) return route.continue();
      if (url.startsWith("https://img.youtube.com/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#333844"/><text x="160" y="90" text-anchor="middle" fill="#fff" font-size="22">参考サムネ · 合成画像</text></svg>' });
      return route.abort();
    });
    await page.addInitScript(({ all }) => {
      if (localStorage.getItem("qa-seeded")) return;
      all.forEach((p) => localStorage.setItem("mg:monogataritch-proj-" + p.id, JSON.stringify(p)));
      localStorage.setItem("mg:monogataritch-index-v1", JSON.stringify(all.map(({ id, name, channel, createdAt }) => ({ id, name, channel, createdAt }))));
      localStorage.setItem("mg:lastView", JSON.stringify({ id: "fixture-2", tab: "plan" }));
      localStorage.setItem("qa-seeded", "1");
    }, { all });
    await page.goto(origin);
    await page.waitForSelector('[data-plan-case="fixture-0"] .mg-plan-title');
    await page.waitForFunction(() => [...document.querySelectorAll('.mg-plan-card')].every((c) => c.querySelector('.mg-plan-reference')), null, { timeout:10000 });
    const card = page.locator('[data-plan-case="fixture-2"]');
    const validate = async () => {
      const metrics = await page.evaluate(() => {
        const inside = (el, parent) => { const a = el.getBoundingClientRect(), b = parent.getBoundingClientRect(); return a.width === 0 || (a.left >= b.left - 1 && a.right <= b.right + 1); };
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          sidebarWidth: document.querySelector('.mg-sidebar').getBoundingClientRect().width,
          cards: [...document.querySelectorAll('.mg-plan-card')].map((c) => ({
            controlsFit: [...c.querySelectorAll('.mg-plan-meta button,.mg-plan-meta summary,.mg-plan-dates>span,.mg-plan-copy')].every((el) => inside(el, c)),
            referenceY: [...c.querySelectorAll('.mg-plan-reference')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => Math.round(el.getBoundingClientRect().top)),
            visibleReferences: [...c.querySelectorAll('.mg-plan-reference')].filter((el) => el.getBoundingClientRect().width > 0).length,
            titleClipped: c.querySelector('textarea').scrollHeight > c.querySelector('textarea').clientHeight + 2
          }))
        };
      });
      assert.equal(metrics.overflow, false, JSON.stringify({ width, metrics }));
      assert.equal(metrics.sidebarWidth, 200);
      assert.ok(metrics.cards.every((c) => c.controlsFit && !c.titleClipped), JSON.stringify({ width, metrics }));
      if (width > 640) assert.ok(metrics.cards.every((c) => c.visibleReferences === 5 && new Set(c.referenceY).size === 1), JSON.stringify({ width, metrics }));
      else assert.ok(metrics.cards.every((c) => c.visibleReferences === 1));
    };
    await validate();
    const height = await card.evaluate((c) => c.getBoundingClientRect().height);
    await card.getByRole("button", { name: "参考動画を編集", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal.waitFor({ state: "visible" });
    assert.equal(await modal.getByPlaceholder("YouTube URL").count(), 5);
    await modal.getByPlaceholder("構成・演出・サムネなど、参考にしたい要素を1つ").first().fill("物語の見せ方");
    assert.ok(Math.abs(await card.evaluate((c) => c.getBoundingClientRect().height) - height) < 1);
    assert.equal(await modal.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
    await modal.getByRole("button", { name: "閉じる", exact: true }).click();
    if (width <= 640) {
      await card.getByRole("button", { name: "参考動画を見る · 全5本 ＋", exact: true }).click();
      assert.equal(await card.locator('.mg-plan-reference:visible').count(), 5);
      assert.equal(await page.locator('[data-plan-case="fixture-1"] .mg-plan-reference:visible').count(), 1);
      await card.getByRole("button", { name: "参考動画を閉じる −", exact: true }).click();
    }
    await card.getByRole("button", { name: "企画の意図", exact: true }).click();
    const intent = card.locator('dialog.mg-plan-intent');
    await intent.waitFor({ state: "visible" });
    assert.equal(await intent.getByRole('textbox', { name: '企画の補足メモ' }).inputValue(), "保存済みの企画意図");
    await intent.getByRole('textbox', { name: '企画の核・問い' }).fill("なぜ諦めかけたのか？");
    await intent.getByRole('textbox', { name: '視聴者に届けるもの' }).fill("挑戦を続ける希望");
    await intent.getByRole('textbox', { name: '物語の流れ' }).fill("挫折 → 転機 → 再挑戦");
    await intent.getByText('企画元・元素材を登録（任意）').click();
    await intent.getByRole('textbox', { name: '企画元・参考にした企画' }).fill("https://youtu.be/example123");
    await intent.getByRole('textbox', { name: '元素材・関連資料' }).fill("https://drive.google.com/drive/folders/example");
    await intent.getByRole('textbox', { name: '企画の補足メモ' }).fill("Claudeで考えた企画の狙い\n視聴者に届けたいこと");
    await intent.getByRole("button", { name: "閉じる", exact: true }).click();
    assert.ok(Math.abs(await card.evaluate((c) => c.getBoundingClientRect().height) - height) < 1);
    const edits = card.locator('textarea.mg-plan-title');
    await edits.fill(titles[2] + "・編集確認");
    await edits.blur();
    await page.waitForFunction(() => document.querySelector('[data-plan-case="fixture-2"] .mg-plan-script').getAttribute('aria-label').includes('・編集確認'));
    await card.getByRole("textbox", { name: /サムネ文言①/ }).fill("編集したサムネ文言");
    await card.getByRole("textbox", { name: /サムネ文言①/ }).blur();
    // Project switching is the app's explicit flush boundary for buffered edits.
    await page.locator('[data-plan-case="fixture-1"] .mg-plan-script').click();
    await page.waitForFunction(() => { const view=JSON.parse(localStorage.getItem('mg:lastView'));return view.id==='fixture-1'&&view.tab==='script'; });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('mg:monogataritch-proj-fixture-2')).plans[0].thumbText === "編集したサムネ文言");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mg:monogataritch-proj-fixture-2')));
    assert.equal(saved.plans[0].note, "Claudeで考えた企画の狙い\n視聴者に届けたいこと");
    assert.equal(saved.plans[0].storyCore, "なぜ諦めかけたのか？");
    assert.equal(saved.plans[0].viewerPromise, "挑戦を続ける希望");
    assert.equal(saved.plans[0].storyFlow, "挫折 → 転機 → 再挑戦");
    assert.equal(saved.plans[0].inspirationSources, "https://youtu.be/example123");
    assert.equal(saved.plans[0].sourceMaterials, "https://drive.google.com/drive/folders/example");
    assert.equal(saved.plans[0].refs[0].note, "物語の見せ方");
    assert.equal(saved.plans[0].title, titles[2] + "・編集確認");
    assert.equal(saved.plans[0].unknown, "keep-plan");
    assert.equal(saved.plans[0].refs[0].unknown, "keep-reference");
    assert.equal(saved.meta.note, "保持する合成メモ");
    await page.goto(origin + '/?case=fixture-2&tab=plan');
    await page.reload();
    await page.waitForSelector('[data-plan-case="fixture-2"] textarea.mg-plan-title');
    assert.equal(await page.locator('[data-plan-case="fixture-2"] textarea.mg-plan-title').inputValue(), titles[2] + "・編集確認");
    await page.screenshot({ path: path.join(output, "plan-" + width + ".png"), fullPage: true });
    assert.deepEqual(errors, []);
    console.log("plan board actual app:", width, "px passed; layout, modal, edit/save/reload, unknown fields and script navigation");
    await context.close();
  }
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const publicFiles = [
  "index.html", "app.js", "app.css", "tailwind.css", "sw.js", "manifest.json",
  "settings.html", "cases.html", "share.html", "x.html", "lp.html", "mcp-login.html", "_headers", ".nojekyll",
  "icon-192.png", "icon-512.png", "apple-touch-icon.png", "favicon-64.png",
  "logo-header.png", "logo-source.png", "logo-wordmark.png",
];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of publicFiles) await cp(path.join(root, file), path.join(dist, file));

const app = await readFile(path.join(dist, "app.js"));
const version = createHash("sha256").update(app).digest("hex").slice(0, 12);

const indexPath = path.join(dist, "index.html");
const index = (await readFile(indexPath, "utf8"))
  .replace(/app\.js\?v=[^"']+/, `app.js?v=${version}`);
await writeFile(indexPath, index);

const swPath = path.join(dist, "sw.js");
const sw = (await readFile(swPath, "utf8"))
  .replace(/const CACHE = "[^"]+";/, `const CACHE = "monogatari-${version}";`);
await writeFile(swPath, sw);

console.log(`dist ready: ${publicFiles.length} files, version ${version}`);

// 2026-10-01: 学習タブの工程マニュアル（LEARN_GROUPS）を learn.json として公開する。
// Premiereのプラグインの「困ったら聞く」AIが、工程ごとのやり方を読んで解説するため（正本はアプリのソース1か所のまま）。
{
  const src = await readFile(path.join(root, "monogataritch.src.jsx"), "utf8");
  const start = src.indexOf("const LEARN_GROUPS = [");
  if (start >= 0) {
    const open = src.indexOf("[", start);
    let depth = 0, end = open;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === "[") depth++;
      else if (ch === "]") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const groups = new Function("return " + src.slice(open, end))();
    await writeFile(path.join(dist, "learn.json"), JSON.stringify({ groups }, null, 1));
  }
}

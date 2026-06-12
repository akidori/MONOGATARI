# ものがたりっち！ 構成台本 取り込みフロー

AKが「コピー（構成台本テキスト）」をClaude / Claude Codeに送る → 正確にツールへ反映する、の手順。

## ★いちばん簡単：アプリで「✨AIで整形して取り込む」
Claude/GPT/Geminiで書いた原稿・取材メモ・文字起こしを **そのままコピペ** するだけ。
左サイドバー「⤓ 構成台本を取り込み」→ 本文を貼る →「✨ AIで整形して取り込む」。
アプリ→Worker(`/api/parse`)→Claude API が構成台本(project JSON)に整形→新規案件化（数秒）。
APIキーは Worker の secret に隠れているので安全。形がきっちり決まったJSON/TSVなら「そのまま取り込む」でも可。

> Worker のセットアップ（初回のみ。AKのCFアカウントで）:
> ```bash
> cd worker
> npx wrangler secret put ANTHROPIC_API_KEY   # 既存のAnthropicキーを貼る
> npx wrangler deploy                          # /api/parse を本番反映
> ```
> モデルを変える時は `wrangler.toml` に `[vars]` で `PARSE_MODEL = "claude-haiku-4-5"` 等。既定は claude-sonnet-4-6。

## （手動でやる場合）反映の経路は2つ

### A. アプリ内に取り込む（編集したい・自分の案件にしたい時）
1. AK が構成台本のコピーを Claude に送る
2. Claude が **project JSON** に整形して返す（`{ name, channel, meta, rows:[...] }`）
3. AK がアプリ左サイドバー **「⤓ 構成台本を取り込み」** にJSONを貼付 → **新規案件として取り込む**
4. ロケ／シーン／秒数／原稿／番組情報まで丸ごと復元される
5. そのまま編集 → **「共有」** で自分の token のリンクを発行・更新

- 逆向き（ツール → 整形テキスト）はヘッダーの **「台本コピー」** でTSVを書き出せる。
  そのTSVも同じ取り込み口にそのまま貼れる（往復可能）。
- スプシから直コピーしたTSVも取り込める（引用・セル内改行対応）。

### B. 共有リンクを即発行する（とりあえず見せたい時）
AK はコピーを送るだけ。Claude Code 側で：

```bash
# 1) コピー → project JSON を作る（案件ごとにビルダーを用意 or 手で書く）
node tools/build_orix_nagata.mjs        # → cases/xxx.project.json

# 2) 共有スナップショットを発行
node tools/publish.mjs cases/xxx.project.json
#   → 共有URL と token が出る。token は控える（次回更新に使う）

# 既存IDを同じURLのまま更新する場合
node tools/publish.mjs cases/xxx.project.json <id> <token>
```

閲覧用リンク（`share.html?id=...`）が即出る。編集はAの経路でアプリに取り込む。

## データ形式（project JSON）
```jsonc
{
  "name": "案件名",
  "channel": "クライアント名",
  "meta": { "shootDate": "", "place": "", "titles": ["","",""], "thumbs": ["","",""], "highlight": "冒頭フック" },
  "theme": { "main": "#241A12", "accent": "#E8A33D" },
  "rate": 5,            // 字/秒
  "timeFormat": "tc",   // "tc"=00:00 / "jp"=0分00秒
  "rows": [
    { "kind": "location", "label": "出社", "time": "8:50" },
    { "kind": "scene", "type": "訴求", "sec": 180, "label": "自己紹介＝つかみ", "script": "◼ …" }
  ]
}
```
- `type`: インサート / ブリッジ / VLOG / 解説系 / 訴求
- `sec`: そのシーンの目標秒数（省略=種別の既定）
- `script`: 原稿。`◼ ` 始まりはインタビュアーの質問として強調表示される

## ビルド（アプリ本体を変えた時）
```bash
npm install      # 初回のみ
npm run build    # monogataritch.src.jsx → app.js（--charset=utf8）
git add -A && git commit && git push   # GitHub Pages へ反映
```

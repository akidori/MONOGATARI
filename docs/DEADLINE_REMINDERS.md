# 工程の締切リマインド＋マニュアル配信（2026-09-26）

AK「ものがたりっちで各工程の日程も把握して、登録した編集者のアドレスとアプリの通知で催促する＋マニュアルの情報を提供する形にすれば、受動的にマニュアルを共有できる」。

## 動き

- 毎朝 8:00（日本時間、Worker cron `0 23 * * *`）に `worker/src/reminders.js` の `runDeadlineReminders` が動く
- **日程の正本は Studio OS**：`GET /api/v1/deliverables?productionStatus=active&expand=detail` で、`mgProjectId` が付いた進行中の案件の工程（`deliverable_steps`）を読む。ものがたりっち側に日程は持たない
- **対象の工程**：編集者の工程だけ。テンプレの担当役割（`defaultRole`）が `Editor` の工程。役割が未設定のテンプレは工程名（編集・修正・初稿・素材整理・納品）で判定。完了・スキップ済みは除く
- **タイミング**：締切の前日・当日・超過（超過中は毎朝）
- **宛先**：その案件にものがたりっちで登録された共同編集メンバー（オーナーを除く）。メール（ZHC bot `BOT_API_URL` 経由、招待メールと同じ経路）とアプリ内通知（右上のベル）
- **重複防止**：同じ工程・同じ段階・同じ日には1回だけ（KV `remind:<案件>:<工程>:<段階>:<日付>`、3日で消える）
- **マニュアル**：工程に合う節の要点を最大2節添える。対応表は `STEP_GUIDES`（reminders.js）1か所
  - 素材整理 → マニュアル「必ず守るルール」＋構成のルール「C. 引き出し方」
  - 本編集・粗編・初稿 → 構成のルール「A. セクション5種」「B. 脳の順番」
  - 修正 → マニュアル「必ず守るルール」＋構成のルール「D. 原稿の書式」
  - 最終修正・納品 → 公開前チェック「人が必ず確認すること」「判断原則」
  - 本文は `knowledge/*.md` と `tools/SCRIPT_GEN_PROMPT.md` を Worker に同梱して毎回そこから抜き出す（二重管理しない）

## API（Worker）

- `GET /api/notifications` → `{ items, unread }`（ログイン中の本人宛、最新50件）
- `POST /api/notifications/read` `{ ids }` または `{ all: true }`
- `POST /api/reminders/preview` → 今朝の対象を送らずに返す（`LEGACY_STREAM_OWNER_EMAIL` のみ）

## 必要な設定

- 既存の Secret だけで動く：`STUDIO_AGENT_KEY`（Studio OS 読み取り）、`BOT_API_URL` / `BOT_API_KEY`（メール）
- Worker のデプロイ：`cd worker && npx wrangler deploy -c wrangler.toml`（`-c` を付けないとリポジトリ直下の Pages 用設定を拾う）

## 前提・制限

- Studio OS の案件に `mg_project_id` が紐付いていて、工程に締切が入っていること。締切が未設定の工程は催促しない（推測で補わない）
- ものがたりっちで編集者を案件に登録していない案件は送らない（メンバー画面・ホームのカードから登録）

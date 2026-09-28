# ホーム画面「今日の仕事」— Studio OS連携（2026-09-23）

## 背景

ホームのタスク管理は2026-08-21のFlip Board退役後、後継の置き場がないまま空白になっていた
（`project.status`/`nextAction`/`deadline` は当時から誰も書き込まない死んだフィールドで、
復活させても意味のあるデータにはならない）。Studio OSが「production and delivery source of truth」
であるため、ホームの「今日の仕事」はStudio OS側のデータをその都度取得して表示する。

## 経路

```
ブラウザ(monogataritch.src.jsx)
  → GET /api/today （mg-share Worker・要ものがたりっちログイン）
    → POST https://studio-os-5dm.pages.dev/api/v1/mcp （JSON-RPC 2.0）
      tools/call: get_work
```

`get_work` はStudio OS側で既存のMCPツール（`functions/api/v1/[[path]].js` の `mcpTools()`）。
今日の仕事ページ（案件の今の工程・工程期限・請求までの工程数、請求・入金、その他の仕事、
**待ち**、保留を見出しごとにグループ化したもの）を1回で返す。「確認待ち」も待ちグループとして
ここに含まれるため、別途APIを叩く必要はない。

## 必要な設定（未設定・要確認）

このセッションからはCloudflareにもStudio OSにも到達できないため、以下はコードの用意のみで
実際の設定・デプロイは未実施：

1. **studio-os側**: `MCP_API_KEY`（Bearerキー）と `MCP_MEMBER_ID`（このキーが動く本人＝AKさんの
   member id）をPages Secretとして設定（`wrangler pages secret put MCP_API_KEY` 等）。
   `functions/_middleware.js` の実装上、既に対応済みのはずだが値が入っているか要確認。
2. **monogatari側（mg-share Worker）**: `STUDIO_MCP_KEY` を1と同じ値で設定
   （`wrangler secret put STUDIO_MCP_KEY`、`worker/wrangler.toml` にコメントで記載済み）。
3. 両方設定してWorkerを再デプロイすれば、ホームに「今日の仕事」セクションが自動で出る
   （未設定の間は `connected:false` を返し、ホーム側は何も表示しない＝安全側に倒してある）。

## 表示方針

Studio OS自身のホームが「待ちは既定で畳んでおき、開いた時だけ詳細を見せる」
（AK 2026-09-07 §4）という設計のため、ものがたりっち側も同じ思想に合わせ、
グループごとの件数だけを常時表示し、クリックで詳細を展開する形にしてある。

## 未確認事項

- `get_work` のレスポンス形（`groups[].key`/`title`/`rows[]`）は `functions/api/v1/_mcp.js`
  の `compactWork()` の実装から読み取ったもので、実際にStudio OS本番へ問い合わせて確認した
  ものではない（このセッションからは到達不可のため）。デプロイ前に一度実データで見た目を確認すること。
- `MCP_API_KEY`/`MCP_MEMBER_ID` が本番に既に設定済みかどうかは未確認。

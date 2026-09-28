# ものがたりっち ローカルMCP

本人のCloudflare認証を使う、Mac上の読み取り専用MCP。HTTPサーバーや公開URLは追加しない。

- `list_projects`: 所有者を固定した案件一覧（ページングあり）
- `get_script`: 案件の名前・チャンネル・台本rows（ページングあり）
- 共有トークンなどの機密フィールドは返さない
- 任意SQL、別ユーザー指定、更新、削除、公開は提供しない
- 新規台本のアプリ保存は未実装。ローカル生成とは別の段階

設定: `MONOGATARI_OWNER_SUB` は既存の `tools/register_case.mjs` に定義された所有者。認証情報は設定ファイルに複製せず、Wranglerが管理する既存ログインを利用する。Cloudflareアカウントの権限自体は広いため、このプログラムを第三者向けサービスとして公開しない。

起動: `node tools/mcp/server.mjs`

確認: `node tools/mcp/test.mjs`。実接続確認: `node tools/mcp/test.mjs --live`（環境変数に所有者IDが必要）。実接続テストは件数だけ表示し、本文はログに出さない。

Codex登録後、実行中の会話にツールが反映されなければ、MCP設定で再起動する。削除する場合は `codex mcp remove monogataritch`。アプリ本体と既存台本は変更しない。

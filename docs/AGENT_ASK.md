# AIに質問（ものがたりっちAIエージェント）— 2026-09-26

AK「ナレッジ自体は見せなくてOKで、必要な時に質問したら回答してくれる、そのタイミングになったら出力してくれればOK」。

- **ナレッジの一覧・候補は画面に出さない**（ナレッジ画面の入口・ホームのBrain・アナリティクスのナレッジ欄を外した。承認は Studio OS で行う）
- **必要な時に聞く**：ホームと案件画面のヘッダーの「AIに質問」から質問する。案件を開いている時は、その案件の資料（基本情報・質問の答え・取材メモ・規定/NG・台本・未完了の修正指摘）を添えて聞く
- **そのタイミングで届く**：工程の締切の前日・当日・超過に、その工程のマニュアルの要点がメールと通知で届く（`docs/DEADLINE_REMINDERS.md`）

## 答え方

- 指示書は `agent/PROMPT.md`（品質ループ `agent/eval/` で改善中。ループの結果をmainに取り込むと、アプリの答え方も変わる）
- 根拠はマニュアル・構成のルール（`tools/SCRIPT_GEN_PROMPT.md`）・公開前チェック・`knowledge/qa.md`・案件資料だけ。Worker に同梱し、毎回そこから渡す（指示書＋資料はプロンプトキャッシュ）
- お金・日程・先方対応・構成変更・センシティブ・資料に無いことは答えずに **AKへ回す**。AK（`ADMIN_EMAILS`、未設定なら `LEGACY_STREAM_OWNER_EMAIL`）にアプリ内通知とメールが届く。回った質問は KV `agentq:inbox` に最新200件
- AKが答えた内容を `knowledge/qa.md` に追記すると、次から同じ種類の質問にはAIが出典付きで答える

## API（Worker）

- `POST /api/agent/ask` `{ question, caseId?, caseName?, context? }` → `{ verdict: "回答"|"AKへ", text }`
  - ログイン必須。1人1日60問まで
  - モデルは `AGENT_MODEL`（未設定なら `claude-opus-5`）。拒否された時はサーバー側のフォールバック（`fallbacks: "default"`）、それでも拒否ならAKへ回す
  - Secret は既存の `ANTHROPIC_API_KEY` を使う

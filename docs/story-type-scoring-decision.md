# 物語タイプ別採点：実装前の判断差分

2026-10-05 / 調査基点 `a8cd10d`（main、PR48マージ）。これは実装・正式ナレッジではなく判断用の提案。

## 結論と停止理由

現行採点は未対応。選択型と異なるPixar要件で減点される問題は残っている。ただし、Campbell／Cinderellaの正式な採点基準と、生成時に選んだ型の案件保存フィールドを確認できなかった。新しい基準を創作せず、依頼の「仮説rubric追加や大規模設計変更が必要なら判断用差分を用意して停止」に従い、実行コードは変更しない。

## 確認した事実

| 対象 | 現行の証拠 |
| --- | --- |
| 生成の選択肢 | `tools/SCRIPT_GEN_PROMPT.md`「①前提条件」にキャンベル／シンデレラ／ストーリースパイン。用途の説明だけで採点基準ではない |
| 正式な制作基準 | `knowledge/SCRIPT_PRODUCTION_MANUAL_V1.md`（approved）手順3はPixar7段＋スパイン＋2段クライマックス。`knowledge/qa.md`に代替型の採点定義なし |
| 未決定の履歴 | `agent/eval/runs/2026-09-28.md` Q19および`agent/eval/FINAL_REPORT.md`：生成指示書の型とマニュアルの関係が未解決 |
| フロントの別概念 | `monogataritch.src.jsx`の`STORY_FRAMEWORKS`は`spine / pixar / kishotenketsu / threeAct`。`pixar`は5段表示で、採点の7段とも異なる |
| 保存コード | `spineFw`は端末共通のlocalStorage `mg:spineFw`。案件ごとの生成型ではない。`rows[].spine[fw]`は段階の手動割当、`mindmapNotes/Pos/Width`も配置用。現mainで`setSpineFw`の呼出箇所は見つからず、選択UIが動いているとは断定しない |
| 採点送信 | `ScriptCheckPanel.run`はcaseId/caseName/channel/context/checksのみ送信。構造化した型は送らない |
| 採点処理 | `src/script-check.js`のCRITERIAは固定8項目。Workerの`POST /api/script/review`は固定spine/climaxをprompt・tool schema・結果正規化に使用 |
| 結果保存 | `mg:scriptReview:<project.id>`に結果を保存するが、型・rubric版なし。型を追加するだけでは旧結果との表示不一致が起きる |

`.agents/skills`とAGENTS.mdはcheckoutに存在しない。`CLAUDE.md`の機能保全・feature guardを確認。open PRは35/36で、今回の型別採点と重複する実装は確認できなかった。両PRとStudioOSは変更しない。

## 本人に必要な最小判断

**代替型の正式基準が揃うまで、明示された代替型では「骨組み・2段クライマックス」を採点対象外（null・平均除外）にし、既存の共通ルールだけ採点する暫定方式でよいか。**

これは型別基準の創作ではなく、適用未確定の2項目を保留する提案。スパインの因果関係・反転の主体など、正式マニュアルの共通ルールは残す必要がある。どの規則が全型共通かも正式記録と整合させる。全項目を採点したい場合は、承認済みの代替型基準の所在または原文が必要。正式原文の更新は別途提案に留める。

## 承認後の最小実装案（未実装）

1. 案件単位に生成型を明示的に保存する小さなフィールドと選択UIを追加する。候補は`meta.storyType`。実保存データとの衝突を読取専用で確認してから決定する。端末共通`mg:spineFw`、台本本文、用途から型を推測・移行しない。MCP/インポート/保存経路で未知フィールドを失わないことを確認する。
2. 共有純粋関数で型→適用基準を解決し、画面の表示名・リクエスト・Workerのprompt/schema/結果正規化を揃える。rubricはサーバー側の承認済み定義に限定する。型別要件を他項目や総評へ転嫁して減点しないよう、資料全体を渡す現promptも確認する。
3. 未選択・旧リクエストは従来基準と表示を維持し、自動保存・自動型付けしない。未知の明示型はPixarへ落とさず、型依存採点を保留する。案件/型/基準の読込失敗は再試行表示で採点を開始せず、既存データ・結果を保持する。
4. レスポンスに適用型・rubric版を含め、実際に使用した基準を結果に表示する。旧結果は「従来基準の結果」と区別する。案件/型変更中の遅延レスポンスを別案件へ表示しない。新フロントと旧Workerの組合せで型別採点を誤表示しない。
5. PR45の質問文脈、PR46のNG優先/AK例外、PR47/48の機械チェック、判断材料なしnull・平均除外、最大15件・重複抑制を維持する。

## 検証と未確認

- 現mainの`npm test`：12スクリプト全成功。既存合成fixtureの機械チェック・null平均除外・QA優先順位等を含む。型別動作は未実装であり、この成功は型別動作の検証ではない。
- `npm ci --ignore-scripts --no-audit --no-fund --cache /tmp/monogatari-npm-cache`と`npm run build`成功。生成物差分なし。`git diff --check`成功。UI操作試験は未実施（本PRは文書だけ）。
- 将来追加する合成ケース：全既知型、未選択、旧データ、未知型、読込失敗、旧Worker、案件/型切替と遅延レスポンス、旧結果、欠落資料、共通NG規則、最大15件・重複、実際の送信rubricとUI一致。LLMはスタブで実呼出ししない。
- 本番`https://monogataritch.pages.dev/`はCONNECT 403で取得不可。本番がmainと一致するかは未確認。
- 実案件の保存値は未取得。リポジトリに実保存JSONのfixtureはなく、認証済みの読取専用データ経路も今回確保できていない。既存`/api/kv/get`はlazy migrationを伴うため、データ保全のため呼ばない。現地端末のlocalStorageも未確認。コード上の保存形式の調査と、実保存値の確認を区別する。
- 有料LLM/API、新credentials/grants、顧客データへの書込み、本番デプロイ、main mergeは実施しない。

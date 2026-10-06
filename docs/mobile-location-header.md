# モバイル構成タブ：ロケ見出しの巨大空白

2026-10-05。main `a8cd10d9`から独立した修正。PR49/50、台本・秒数・時刻・チェックのデータ構造と保存処理は変更しない。

## 再現と原因

元のprivateスクリーンショットはこの実行環境では取得に失敗し、指定回数後に再試行を停止した。親側の画素確認に基づく観測（黒い見出しが約400px、番号/尺/日/時刻/完了が中央）を受け、コードから独立した合成再現を行った。

現mainのロケ見出しJSX・AutoTextarea・useBufferedField・日選択をそのまま切り出し、合成ロケ名と04:35/1日目/13:00を与えると、430px幅で見出し447px・ロケ名textarea幅0px/高さ421pxになった。修正前スクリーンショットを実際に目視し、同じ巨大空白を確認した。左レールの高さ継承ではなく、タイトルの`flex-1`（basis:0%）により番号と固定幅の操作群が同じ行に残り、タイトルが潰れることが原因。AutoTextareaのscrollHeight計測が、幅0の文字折返しに応じて縦に伸びていた。

修正は当該タイトル欄の`flex-1`を`flex-[1_1_12rem]`にする1箇所。折返し判定にタイトルの基準幅を与えて操作群を次行へ送り、AutoTextareaの内容相当の高さを保つ。高さ固定・文字切捨て・算術変更は行わない。

| 幅 | 修正前 見出し高さ/タイトル幅 | 修正後 見出し高さ/タイトル幅 |
| --- | --- | --- |
| 375 | 109px / 209px | 109px / 209px |
| 390 | 109px / 224px | 109px / 224px |
| 430 | 447px / 0px | 109px / 264px |
| 1440 | 89.5px / 708px | 89.5px / 708px |

上部タブは現mainで`overflow-x-auto`、`w-max`、右端グラデーション、選択時scrollIntoViewを持つ意図的な横スクロール。今回は変更しない。

## 検証

- `npm test`：既存12スクリプト成功。`npm run build`、`git diff --check`成功。app.js/tailwind.cssは生成物の更新のみ。
- `PLAYWRIGHT_MODULE=/tmp/monogatari-ui/node_modules/playwright/index.mjs node tools/test-mobile-location-header.mjs`：375/390/430/1440のChromium合成試験成功。折返し・幅変更、横はみ出しなし、文字クリップなし、ロケ完了/解除、インサートチェック/折畳み/再展開、カット追加、ロケ名編集、シーン追加、スクロール、合成JSON保存/再読込を確認。未捕捉JSエラー0。幅変更だけではJSON変更なし。
- ヘッダー、AutoTextarea、日選択、インサートチェック/折畳み、追加ボタンは実ソースから抽出。rich editor内部は単純textareaで代用し、保存先は合成localStorageのみ。App全体の保存経路・実iOS Safari・実案件を操作した検証ではない。時刻13:00・day1・sec5・未知フィールドの保持を確認。04:35は固定の表示fixtureであり算術の正否は検証対象外。
- before/after 430px画像を目視確認。安全な合成画像2枚はLibrary `libfile_0be4db981a508191b48ce793e4672f18`（mobile-header-synthetic-before-after.zip）に保存。private原画像はrepoへ追加していない。

## 公開条件

本番URLはCONNECT403で取得できず、本番版とmainの一致は未確認。今回の修正はfrontendだけで反映可能（Worker/DB/認証変更なし）。本番に別の未反映ソースがある場合は、そこへこの1箇所だけを適用して生成物を再buildする必要がある。PR49/50と同時統合する場合もapp.jsを片側採用しない。本番反映・mergeは未実施。デプロイ承認前に本番基点を照合する。

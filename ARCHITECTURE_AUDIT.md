# ものがたりっち：共有前の構成監査

更新日: 2026-07-29

## 結論

現在は「Googleログインした各利用者のGoogle Driveへ保存」ではない。保存・変換・AI処理は、ほぼすべて運営者（AK）のCloudflare／外部API契約へ集約される。

不特定多数へ公開する前に、次の二段階へ分ける。

1. チーム版: AKの基盤を使う招待制。容量・回数・保存期限・管理画面を設ける。
2. 個人版: 利用者のGoogle DriveとAI APIキーを使うBYOS/BYOK方式。

最初から利用者へCloudflareのR2アクセスキーを入力させる方式は採用しない。ブラウザ保存された長期R2キーは漏えい時の被害が大きく、利用者自身にもCloudflare設定が必要になるためである。

## 現在のデータフロー

| データ | 現在の保存先／送信先 | 課金・容量の持ち主 |
|---|---|---|
| 未ログインの案件 | ブラウザ `localStorage` | 利用者端末 |
| Googleログイン後の案件JSON | Cloudflare Workers KV `SNAPS` の `u:<Google sub>:` | AK |
| 共有スナップ、コメント、ファイルメタデータ | Cloudflare Workers KV `SNAPS` | AK |
| 動画、画像、素材、納品ファイル | Cloudflare R2 `mg-files` | AK |
| 確認用動画変換 | Cloudflare Stream | AK |
| リアルタイム共同編集 | Cloudflare Durable Objects | AK |
| 台本生成・校正・相談 | Workerに設定した共通Anthropic APIキー | AK |
| YouTube調査 | Workerに設定した共通YouTube APIキー | AK |
| Flip-LAB／Flip Board連携 | AKの別WorkerへのService Binding | AK |
| `cases.html` の任意同期 | 利用者が設定したGAS→Google Sheets | GASを設定した利用者 |
| `settings.html` のAI接続テスト | ブラウザから各AIへ直接 | 入力したキーの持ち主 |

`settings.html` のGemini／Claude／OpenAIキーは接続テストとGeminiミニプレイグラウンドだけで、本体のAI機能では使われていない。

## 共有前に直すべき問題

### P0: 費用・容量がAKへ集中

- R2、Stream、KV、Durable Objects、Anthropic、YouTube APIが共通契約。
- ユーザー別の容量集計、月間上限、停止スイッチがない。
- R2原本を無期限保存する経路がある。

### P0: 公開APIの濫用面

- AI APIはIP単位の簡易レート制限のみ。ログインユーザー別予算がない。
- ゲストコメント／返信は共有URLを知る人なら投稿可能。
- ライブ文書作成APIはログイン不要で、DO作成・再seedが可能。
- ファイルアップロードは共有リンク型であるため、漏れたURLは容量消費につながる。

2026-07-29に、R2マルチパートへ24時間の署名付きcapabilityを追加し、完了時にR2実サイズを検証する修正を実施した。

### P1: 認証と権限

- Google ID tokenによるログインは「誰であるか」の確認であり、Drive利用許可ではない。
- 共同編集、共有閲覧、アップロード、管理の権限モデルが複数トークンへ分散している。
- セッショントークンをlocalStorageに置いているため、XSSが起きると奪取される。将来はHttpOnly/Secure/SameSite Cookieを推奨。
- Googleログインの許可ドメイン／組織制限または招待制が必要。

### P1: UX上の誤解

- 「Googleでログイン」「クラウド同期中」という表示から、Google Drive保存だと誤認しやすい。
- `settings.html` のAPIキー設定は本体AIへ反映されない。
- 本体、`settings.html`、`cases.html` に異なる保存・連携方式が併存している。

## 推奨する個人版アーキテクチャ

### 認証

- Google Identity ServicesのAuthorization Code Flowを使う。
- ログイン用ID tokenと、Drive操作用OAuth同意を明確に分ける。
- Drive scopeは原則 `https://www.googleapis.com/auth/drive.file`。アプリが作成したファイル／利用者が明示的に選んだファイルだけに限定する。
- refresh tokenはブラウザに置かず、Worker側で暗号化してユーザー単位に保存する。

### 保存

- 案件JSON: 利用者のDriveに、アプリ専用フォルダ内のJSONとして保存。
- 動画・素材: 利用者が選んだDriveフォルダへresumable upload。
- Worker側には `user sub -> Drive folder id / encrypted refresh token /設定` だけを保持。
- 共有レビュー: Driveの共有URLだけでは時間指定コメント等が不足するため、コメントと共有スナップは当面Cloudflare側に残す。ファイル本体だけDriveへ逃がすハイブリッドが現実的。

注意: Drive動画をCloudflare Streamへコピーすれば、Stream費用は引き続きAK負担になる。個人版の初期版ではDriveプレビュー／直接再生を使い、Stream変換は「運営プランのみ」にする。

### AI（BYOK）

- 利用者がAnthropic／OpenAI／Geminiのキーを登録。
- APIキーをlocalStorageへ平文保存しない。
- Workerへ送信し、ユーザーごとに暗号化保存する。復号鍵はCloudflare Secretに置く。
- 各AIリクエストはログイン必須にし、ユーザー自身のキーだけを復号して利用する。
- ログ、例外、分析イベントへキーを出さない。末尾4文字だけ表示する。
- キー未登録時はAI機能を無効表示し、AKの共通キーへ自動フォールバックしない。

## 実装順

### Phase 0: 公開を止めずに守る

- [x] R2アップロードcapabilityと実サイズ検証
- [ ] `/api/live/create` をログインまたは既存共有token必須にする
- [ ] AI APIをログイン必須化し、ユーザー／日ごとの上限を設ける
- [ ] ゲストアップロードを既定OFF、案件ごとの明示ONにする
- [ ] ユーザー別R2使用量とアップロード回数を記録
- [ ] 管理者の緊急停止スイッチを用意

### Phase 1: 表示と設定を正す

- [ ] 「Googleログイン＝Cloudflare上の個人領域」と明記
- [ ] 使われていないAI設定を本体へ統合するか、設定ページから削除
- [ ] 保存先、保存期限、削除方法をアカウント画面に表示
- [ ] データエクスポート／アカウント削除を追加

### Phase 2: Google Driveへファイルを分離

- [ ] Google CloudでDrive APIとOAuth consent screenを設定
- [ ] Authorization Code Flowとrefresh token保管を実装
- [ ] `drive.file` scopeでアプリ用フォルダを作成
- [ ] 案件JSONのDrive同期
- [ ] Drive resumable uploadで動画／素材を利用者領域へ保存
- [ ] 既存R2ファイルの移行ツールを作る

### Phase 3: BYOK

- [ ] ユーザー別暗号化secretストア
- [ ] provider/model選択
- [ ] `/api/parse` 等をログイン必須＋ユーザーキー利用へ変更
- [ ] 利用量表示、接続テスト、キー削除

## 公開形態の判断

最短で安全なのは「招待制チーム版」。誰でも登録できる一般公開は、Phase 0をすべて終え、利用規約・プライバシー説明・削除導線・費用上限を用意してからにする。

長期的には次の2プランが扱いやすい。

- 個人版（無料／低価格）: 自分のGoogle Drive＋自分のAIキー。Streamなし。
- 運営版（有料）: AKのR2／Stream／AIを利用。容量・生成回数に上限。


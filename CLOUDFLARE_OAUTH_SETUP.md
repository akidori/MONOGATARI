# 利用者自身のCloudflare Stream接続：運営設定

コード実装後に、運営者が一度だけ行う設定。利用者にAPIキーを入力させない。

## 1. OAuth clientを作成

Cloudflare Dashboard → 対象アカウント → Manage Account → OAuth clients → Create client。

- Client name: `ものがたりっち`
- Response type: `code`
- Grant type: `authorization_code`
- Token authentication: `client_secret_basic`
- Redirect URL: `https://mg-share.aki-surf89315.workers.dev/api/cf/oauth/callback`
- Client URL: 本番の独自ドメイン
- Scopes: `Stream Read` と `Stream Write`

公開アプリにするにはClient URLの独自ドメイン所有確認が必要。`pages.dev`だけで公開化せず、本番独自ドメインを先に決める。

## 2. Worker設定

`worker/wrangler.toml` の以下を設定する。

- `APP_ORIGIN`: 本番アプリのorigin
- `CF_OAUTH_CLIENT_ID`
- `CF_OAUTH_REDIRECT_URI`
- `CF_OAUTH_SCOPES`: OAuth client画面/APIで得たscope IDを空白区切り

Client secretはファイルへ書かず、Worker secretにする。

```sh
cd worker
npx wrangler secret put CF_OAUTH_CLIENT_SECRET
```

## 3. privateからテスト

OAuth clientがprivateの間は、OAuth clientを作ったCloudflareアカウントのメンバーだけ接続できる。

1. Googleログイン
2. アカウント → Cloudflareを接続
3. Cloudflare同意画面で対象アカウントを選ぶ
4. 30GB未満の動画をアップロード
5. ブラウザ→利用者のStreamへTUS直送されることを確認
6. HLS変換完了後、時間指定コメントとシークを確認
7. AKのR2 `mg-files` に動画本体が増えていないことを確認

## 4. public化

Client URLのDNS TXT所有確認、ロゴ、利用規約、プライバシーポリシーを設定してからOAuth clientをpublicへ変更する。public化は元へ戻せないため、privateテスト完了後に行う。

## 実装上の安全策

- OAuth access/refresh tokenはブラウザへ返さない。
- tokenはAES-GCMで暗号化してユーザー別KVへ保存。
- 動画はWorker/R2を経由せず、Cloudflare発行の一回限りTUS URLへ直送。
- 30GB上限をアプリ側でも検査。
- 接続解除時はOAuth tokenをrevokeし、保存済みtokenを削除。
- 未接続ユーザーは従来経路を維持（公開前に無料枠/禁止モードへ変更可能）。


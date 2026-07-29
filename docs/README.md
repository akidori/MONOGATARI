# ものがたりっち プロダクト資料

更新日: 2026-07-29

## 資料一覧

1. [機能一覧](FEATURE_CATALOG.md)  
   現在の画面と機能を、実装済み・条件付き・未実装に分けて整理。

2. [要件定義書](REQUIREMENTS.md)  
   目的、利用者、機能要件、データ要件、非機能要件、一般公開条件を整理。

3. [システム構成・連携一覧](SYSTEM_OVERVIEW.md)  
   Googleログイン、Cloudflare、動画、AI、外部サービスの接続と費用負担を整理。

4. [共有前の構成監査](../ARCHITECTURE_AUDIT.md)  
   現行構成のリスクと、一般公開へ向けた移行方針。

5. [Cloudflare OAuth設定](../CLOUDFLARE_OAUTH_SETUP.md)  
   利用者自身のCloudflare Streamを接続するための運営設定。

## 最初に確認するポイント

- Googleログイン後の案件保存先はGoogle DriveではなくCloudflare KV。
- 利用者自身のCloudflare Stream接続機能はコード実装済みだが、OAuth運営設定が必要。
- 本体AI機能は現在、利用者自身のAPIキーではなく運営側APIを利用。
- 一般公開前に利用者別のAI回数、保存容量、アップロード量の上限が必要。


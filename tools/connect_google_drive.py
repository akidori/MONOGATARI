#!/usr/bin/env python3
"""ものがたりっちの素材置き場を Google Drive（aki.surf89315@gmail.com・5TB）にするための、1回だけの許可取得。

使い方（AKが実行）:
    python3 ~/dev/MONOGATARI/tools/connect_google_drive.py

ブラウザが開くので aki.surf89315@gmail.com を選んで「許可」を押す。
取れた鍵は、そのまま mg-share（ものがたりっちのサーバー）の秘密の設定に登録する。画面には出さない。

権限は drive.file だけ＝このアプリが作ったファイル・フォルダしか読み書きできない（AKのDriveの他のファイルは見えない）。
OAuthクライアントは Studio OS と同じ既存のもの（GCPプロジェクト birdstraike / ~/birdflip-discord-bot/credentials.json）。
"""
import json
import pathlib
import subprocess
import sys

CRED = pathlib.Path.home() / "birdflip-discord-bot" / "credentials.json"
WORKER_DIR = pathlib.Path(__file__).resolve().parent.parent / "worker"
WRANGLER = WORKER_DIR.parent / "node_modules" / ".bin" / "wrangler"
SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def put_secret(name: str, value: str) -> None:
    subprocess.run(
        [str(WRANGLER), "secret", "put", name, "--config", "wrangler.toml"],
        input=value, text=True, cwd=str(WORKER_DIR), check=True,
    )


def main():
    if not CRED.exists():
        sys.exit(f"OAuthクライアントが見つかりません: {CRED}")
    from google_auth_oauthlib.flow import InstalledAppFlow

    flow = InstalledAppFlow.from_client_secrets_file(str(CRED), SCOPES)
    creds = flow.run_local_server(
        port=0, prompt="consent select_account", access_type="offline",
        login_hint="aki.surf89315@gmail.com",
    )
    if not creds.refresh_token:
        sys.exit("refresh_tokenが返りませんでした。もう一度実行してください（同意画面で必ず許可を押す）。")
    info = json.loads(CRED.read_text())["installed"]
    print("mg-share に登録しています...")
    put_secret("GDRIVE_CLIENT_ID", info["client_id"])
    put_secret("GDRIVE_CLIENT_SECRET", info["client_secret"])
    put_secret("GDRIVE_REFRESH_TOKEN", creds.refresh_token)
    print("完了しました。Claudeに「つないだ」と伝えてください。")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""R2 の素材を Google Drive へ写す（2026-10-01 AK「全部写して欲しい」）。

データは mg-share（Cloudflare）の中で R2 → Drive に直接流れる。このMacは指示を出すだけ（回線は使わない）。
R2 の元は消さない（記録だけ Drive に切り替える。DLは Drive から）。途中で止めても、また実行すれば続きから。

使い方: python3 tools/migrate_r2_to_drive.py [並列数=3] [--only KEY]
状態: ~/.config/monogataritch/migrate_state.json（写し終わった key）
"""
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://mg-share.aki-surf89315.workers.dev"
KEYS = pathlib.Path.home() / ".config" / "monogataritch" / "mcp_keys"
STATE = pathlib.Path.home() / ".config" / "monogataritch" / "migrate_state.json"
K = next(l.split("=", 1)[1].strip() for l in KEYS.read_text().splitlines() if l.startswith("MCP_WRITE_KEY="))
H = {"Authorization": "Bearer " + K, "User-Agent": "mg-migrate/1", "Content-Type": "application/json"}


def call(path, body=None, timeout=600):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body is not None else None, headers=H,
                                 method="POST" if body is not None else "GET")
    try:
        return json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{e.code} {e.read().decode()[:200]}")


def plan():
    files, cur = [], None
    while True:
        d = call("/api/ops/migrate/plan" + ("?cursor=" + urllib.parse.quote(cur) if cur else ""))
        files += d["files"]
        cur = d.get("cursor")
        if not cur:
            return files


def load_state():
    try:
        return json.loads(STATE.read_text())
    except Exception:
        return {"done": [], "failed": {}}


def migrate_one(f):
    key = f["key"]
    for attempt in range(3):
        try:
            st = call("/api/ops/migrate/start", {"key": key})
            url, size, off = st["uploadUrl"], st["size"], 0
            drive_id = None
            while drive_id is None:
                r = call("/api/ops/migrate/step", {"key": key, "uploadUrl": url, "size": size, "offset": off}, timeout=900)
                if r.get("done"):
                    drive_id = r["driveId"]
                else:
                    if r["next"] <= off:
                        raise RuntimeError("進みません")
                    off = r["next"]
            call("/api/ops/migrate/finish", {"key": key, "driveId": drive_id})
            return key, None
        except Exception as e:  # noqa: BLE001
            err = str(e)
            time.sleep(5 * (attempt + 1))
    return key, err


def main():
    par = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 3
    only = sys.argv[sys.argv.index("--only") + 1] if "--only" in sys.argv else None
    state = load_state()
    files = [f for f in plan() if f["key"] not in state["done"] and (not only or f["key"] == only)]
    # 期限の近いものから
    files.sort(key=lambda f: (f["expiresAt"] or "9999", f["size"]))
    total = sum(f["size"] for f in files)
    print(f"写す: {len(files)}件 {total/1e9:.1f}GB（並列{par}）", flush=True)
    t0, moved = time.time(), 0
    with ThreadPoolExecutor(par) as ex:
        for i, (key, err) in enumerate(ex.map(migrate_one, files), 1):
            f = next(x for x in files if x["key"] == key)
            if err:
                state["failed"][key] = err
                print(f"[{i}/{len(files)}] 失敗 {f['name']}: {err}", flush=True)
            else:
                state["done"].append(key)
                state["failed"].pop(key, None)
                moved += f["size"]
                el = time.time() - t0
                print(f"[{i}/{len(files)}] 済 {f['name']} {f['size']/1e6:.0f}MB  累計{moved/1e9:.1f}GB  {moved/1e6/max(1,el):.0f}MB/s", flush=True)
            STATE.write_text(json.dumps(state, ensure_ascii=False))
    print(f"終わり: 済{len(state['done'])} 失敗{len(state['failed'])}", flush=True)


if __name__ == "__main__":
    main()

// https://monogataritch.pages.dev/mcp → mg-share Worker の /mcp へそのまま転送する。
// D1/KV/APIキーは Worker 側だけが持つ（実装は worker/src/mcp.js）。
const WORKER = "https://mg-share.aki-surf89315.workers.dev/mcp";

export const onRequest = ({ request }) =>
  fetch(WORKER, {
    method: request.method,
    headers: {
      "Content-Type": request.headers.get("Content-Type") || "application/json",
      Authorization: request.headers.get("Authorization") || "",
    },
    body: request.method === "POST" ? request.body : undefined,
  });

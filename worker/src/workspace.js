/* ============================================================
   ワークスペース（会社・チーム）とロールの判定（2026-10-17 SaaS化 1本目）
   設計: https://claude.ai/code/artifact/dbd0590d-c444-482b-975a-3a66204b81f1
   まだどこからも呼ばれない。2本目で Worker の権限チェックをここへ寄せる。
   先方（クライアント）はメンバーにせず、今どおり案件ごとの共有リンクで入る。
   ============================================================ */

export const ROLES = ["owner", "director", "editor"];

// できること → それができるロール。editor の「担当案件のみ」は can() ではなく isAssigned() と組み合わせて判定する
const ACTIONS = {
  "workspace.manage": ["owner"],                          // メンバー招待・プラン・請求
  "case.create": ["owner", "director"],
  "case.delete": ["owner", "director"],
  "case.share": ["owner", "director"],                    // 共有リンク発行
  "script.read": ["owner", "director", "editor"],
  "script.write": ["owner", "director"],                  // 台本・編集指示書
  "effort.write": ["owner", "director", "editor"],        // 工数・編集状態（editor は担当案件のみ）
  "video.upload": ["owner", "director", "editor"],        // 確認用動画（editor は担当案件のみ）
  "review.comment": ["owner", "director", "editor"],
};
const ASSIGNED_ONLY_FOR_EDITOR = new Set(["effort.write", "video.upload"]);

export function can(role, action) {
  const allowed = ACTIONS[action];
  return !!allowed && allowed.includes(role);
}

export function isAssigned(project, sub) {
  return !!sub && Array.isArray(project && project.assignees) && project.assignees.includes(sub);
}

/* 案件に対してその人がその操作をできるか。member = { role, sub }（mg_members の行） */
export function canOnProject(member, action, project) {
  if (!member || !can(member.role, action)) return false;
  if (member.role === "editor" && ASSIGNED_ONLY_FOR_EDITOR.has(action)) return isAssigned(project, member.sub);
  return true;
}

/* 所属しているワークスペースから、今回使うものを1つ選ぶ。
   requested が指定されていればそれ（所属していなければ null）。
   指定が無く所属が1つだけならそれ。複数なら選べないので null。 */
export function pickWorkspace(memberships, requested) {
  const list = Array.isArray(memberships) ? memberships : [];
  if (requested) return list.find((m) => m.workspace_id === requested) || null;
  return list.length === 1 ? list[0] : null;
}

/* 停止中のワークスペースでも見るのは止めない。止めるのは書き込み・アップ・AI */
export function isWriteBlocked(workspace) {
  return !workspace || workspace.status !== "active";
}

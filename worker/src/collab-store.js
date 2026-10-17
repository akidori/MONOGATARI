// 案件ごとの共同編集の保存先（SaaS化 2本目・2026-10-17）
// これまでは保存のたびに KV `col:<id>` と `colmember:<email>` を書いていた。KV の書き込みは無料枠で
// 1日1,000回しかなく（07-27 の消失事故と同じ経路）、ワークスペースの権限とも二重になるので D1 に移す。
// - メンバーとオーナーは mg_collab / mg_collab_members、案件の中身はオーナーの mg_kv 行（Studio OS 連携が直読みしている行）
// - KV にしか無い古い共同編集は、最初に読まれた時に D1 へ写す（KV 側は消さずに読み取り専用の控えとして残す）
// - 移行SQL（tools/2026-10-17_collab_d1.sql）が未実行の間は、今まで通り KV に書く

const docKey = (id) => "col:" + id;
const idxKey = (email) => "colmember:" + lc(email);
const projKey = (id) => "monogataritch-proj-" + id;
const lc = (s) => (s || "").toString().trim().toLowerCase();

let d1Ready = false;
// mg_collab があるか。あると分かったらこの isolate では二度と聞かない（無い時は毎回聞き直す＝SQL実行後すぐ切り替わる）
export async function collabInD1(env) {
  if (d1Ready) return true;
  try {
    await env.DB.prepare("SELECT 1 FROM mg_collab LIMIT 1").first();
    d1Ready = true;
  } catch (e) {
    return false;
  }
  return true;
}
export function _resetCollabStoreForTest() { d1Ready = false; }

// オーナーの mg_kv 行に案件を書く。INSERT OR REPLACE は行を作り直して case_id / workspace_id を消すので使わない
function projectWrites(env, ownerSub, id, project, name, channel) {
  const js = JSON.stringify(project);
  const key = projKey(id);
  return [
    env.DB.prepare(
      "UPDATE mg_kv SET value=?, proj_id=?, name=?, channel=?, bytes=?, updated_at=datetime('now','+9 hours') WHERE sub=? AND key=?"
    ).bind(js, id, name || null, channel || null, js.length, ownerSub, key),
    env.DB.prepare(
      "INSERT INTO mg_kv (sub,key,value,proj_id,name,channel,bytes,updated_at) SELECT ?,?,?,?,?,?,?,datetime('now','+9 hours') WHERE NOT EXISTS (SELECT 1 FROM mg_kv WHERE sub=? AND key=?)"
    ).bind(ownerSub, key, js, id, name || null, channel || null, js.length, ownerSub, key),
  ];
}

async function readProject(env, ownerSub, id) {
  const row = await env.DB.prepare("SELECT value FROM mg_kv WHERE sub=? AND key=?").bind(ownerSub, projKey(id)).first();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch (e) { return null; }
}

// 共同編集を1件読む。形は KV 時代の doc と同じ { id, ownerSub, ownerEmail, members, project, name, channel, updatedAt }
export async function loadCollab(env, id) {
  if (!id) return null;
  id = id.toString();
  if (!(await collabInD1(env))) return await env.SNAPS.get(docKey(id), "json");
  const row = await env.DB.prepare("SELECT * FROM mg_collab WHERE id=?").bind(id).first();
  if (row) {
    const ms = await env.DB.prepare("SELECT email FROM mg_collab_members WHERE collab_id=? ORDER BY rowid").bind(id).all();
    let project = await readProject(env, row.owner_sub, id);
    if (!project) {
      // オーナー行が消えていたら KV の控えで返す（次の保存で mg_kv に戻る）
      const old = await env.SNAPS.get(docKey(id), "json");
      project = (old && old.project) || null;
    }
    return {
      id, ownerSub: row.owner_sub, ownerEmail: row.owner_email,
      members: ((ms && ms.results) || []).map((m) => m.email),
      project, name: row.name || "", channel: row.channel || "", updatedAt: row.updated_at,
    };
  }
  // KV にしか無い古い共同編集を D1 へ写す。案件の中身は mg_kv 行がある時はそちらを正とする
  const old = await env.SNAPS.get(docKey(id), "json");
  if (!old || !old.ownerSub) return null;
  const doc = { ...old, id, members: [...new Set((old.members || []).map(lc))] };
  const inD1 = await readProject(env, doc.ownerSub, id);
  if (inD1) doc.project = inD1;
  await saveCollab(env, doc, { project: !inD1 && !!doc.project });
  return doc;
}

// 共同編集を保存する。project=false ならメンバーだけ（招待・退出）で、案件の中身は書かない。
// prevMembers は KV 時代の索引を直すためだけに使う
export async function saveCollab(env, doc, { project = true, prevMembers = [] } = {}) {
  const members = [...new Set((doc.members || []).map(lc))];
  if (!(await collabInD1(env))) {
    await env.SNAPS.put(docKey(doc.id), JSON.stringify({ ...doc, members }));
    for (const em of members) if (!prevMembers.includes(em)) await kvAddIdx(env, em, doc.id);
    for (const em of prevMembers) if (!members.includes(em)) await kvDelIdx(env, em, doc.id);
    if (project && doc.project) {
      try { await env.DB.batch(projectWrites(env, doc.ownerSub, doc.id, doc.project, doc.name, doc.channel)); } catch (e) {}
    }
    return;
  }
  const at = doc.updatedAt || new Date().toISOString();
  const stmts = [
    env.DB.prepare(
      "INSERT INTO mg_collab (id,owner_sub,owner_email,name,channel,updated_at) VALUES (?,?,?,?,?,?) " +
      "ON CONFLICT(id) DO UPDATE SET owner_sub=excluded.owner_sub, owner_email=excluded.owner_email, name=excluded.name, channel=excluded.channel, updated_at=excluded.updated_at"
    ).bind(doc.id, doc.ownerSub, lc(doc.ownerEmail), doc.name || "", doc.channel || "", at),
    env.DB.prepare("DELETE FROM mg_collab_members WHERE collab_id=?").bind(doc.id),
    ...members.map((em) => env.DB.prepare("INSERT OR IGNORE INTO mg_collab_members (collab_id,email,added_at) VALUES (?,?,?)").bind(doc.id, em, at)),
  ];
  if (project && doc.project) stmts.push(...projectWrites(env, doc.ownerSub, doc.id, doc.project, doc.name, doc.channel));
  await env.DB.batch(stmts);
}

// 共同編集をやめる。案件の中身（オーナーの mg_kv 行）は今まで通り残す。
// KV の控えも消す（残すと次に読まれた時に D1 へ写し戻されて復活する）
export async function deleteCollab(env, doc) {
  if (!(await collabInD1(env))) {
    for (const em of doc.members || []) await kvDelIdx(env, em, doc.id);
    await env.SNAPS.delete(docKey(doc.id));
    return;
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM mg_collab_members WHERE collab_id=?").bind(doc.id),
    env.DB.prepare("DELETE FROM mg_collab WHERE id=?").bind(doc.id),
  ]);
  if (await env.SNAPS.get(docKey(doc.id), "json")) await env.SNAPS.delete(docKey(doc.id));
}

// このメールが入っている共同編集の id。D1 を正とし、KV 索引にしか無い id は読んで（＝D1へ写して）メンバーか確かめる
export async function collabIdsFor(env, email) {
  const em = lc(email);
  const kvIds = (await env.SNAPS.get(idxKey(em), "json")) || [];
  if (!(await collabInD1(env))) return kvIds;
  const rs = await env.DB.prepare("SELECT collab_id FROM mg_collab_members WHERE email=?").bind(em).all();
  const ids = new Set(((rs && rs.results) || []).map((r) => r.collab_id));
  for (const id of kvIds) {
    if (ids.has(id)) continue;
    const known = await env.DB.prepare("SELECT 1 AS x FROM mg_collab WHERE id=?").bind(id).first();
    if (known) continue; // D1 に移った後に外された・消された案件
    const doc = await loadCollab(env, id);
    if (doc && (doc.members || []).includes(em)) ids.add(id);
  }
  return [...ids];
}

async function kvAddIdx(env, email, id) {
  const k = idxKey(email); const a = (await env.SNAPS.get(k, "json")) || [];
  if (!a.includes(id)) { a.push(id); await env.SNAPS.put(k, JSON.stringify(a)); }
}
async function kvDelIdx(env, email, id) {
  const k = idxKey(email); const a = (await env.SNAPS.get(k, "json")) || [];
  if (a.includes(id)) await env.SNAPS.put(k, JSON.stringify(a.filter((x) => x !== id)));
}

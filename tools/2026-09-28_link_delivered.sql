-- 2026-09-28 ものがたりっち「担当と納期」の整合：納品済みをStudio OSで完了として連携する
-- スタジアム#1〜#6：#7_させ先生(dl_fb2)と同じ形（アカウント ac_fb4 運命を職業に・完了・請求済み）で登録。
--   売上は Studio OS 導入前に計上済みのため sales_amount は NULL（売上・粗利の数字に入らない）
-- あずささん：既存の完了案件「あずささん（初回）」(dl_fb49) に ものがたりっち ikv7ztlt をひも付け
INSERT INTO deliverables (id,account_id,title,workflow_type,production_status,billing_status,director_name,created_at,updated_at,waiting_on,sales_amount,mg_project_id) VALUES
 ('dl_mg0928_0i6x76pt','ac_fb4','#1_あいみさん','wf_full','completed','invoiced','中村諭律','2026-06-14 13:11:54',datetime('now'),'Nobody',NULL,'0i6x76pt'),
 ('dl_mg0928_oj0qc9h0','ac_fb4','#2_華香さん','wf_full','completed','invoiced','中村諭律','2026-06-14 13:11:54',datetime('now'),'Nobody',NULL,'oj0qc9h0'),
 ('dl_mg0928_6qjtfiuz','ac_fb4','#3_ゆかり先生','wf_full','completed','invoiced','中村諭律','2026-06-14 13:11:54',datetime('now'),'Nobody',NULL,'6qjtfiuz'),
 ('dl_mg0928_zppg7h53','ac_fb4','#4_ママちゃんさん','wf_full','completed','invoiced','中村諭律','2026-06-14 13:11:54',datetime('now'),'Nobody',NULL,'zppg7h53'),
 ('dl_mg0928_pwyhlqmo','ac_fb4','#5_聖良さん','wf_full','completed','invoiced','中村諭律','2026-06-14 13:11:54',datetime('now'),'Nobody',NULL,'pwyhlqmo'),
 ('dl_mg0928_do2ckh3i','ac_fb4','#6_松原さん','wf_full','completed','invoiced','中村諭律','2026-06-14 13:11:54',datetime('now'),'Nobody',NULL,'do2ckh3i');
UPDATE deliverables SET mg_project_id='ikv7ztlt', updated_at=datetime('now') WHERE id='dl_fb49' AND mg_project_id IS NULL;
INSERT INTO activity_logs (id,actor_type,actor_name,action,entity_type,entity_id,after_json,reason,event_type) VALUES
 ('log_mg0928_link','api','Claude Code','update','deliverable','dl_mg0928_*,dl_fb49','{"created":["0i6x76pt","oj0qc9h0","6qjtfiuz","zppg7h53","pwyhlqmo","do2ckh3i"],"linked":{"dl_fb49":"ikv7ztlt"}}','ものがたりっち担当と納期の整合（納品済みをStudio OSで完了として連携）','deliverable.link');

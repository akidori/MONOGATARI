import React, { useEffect, useRef, useState } from "react";
import "./plan-board.css";

// Keep schedule text intact when older projects contain a free-form shoot date.
export const compactPlanDate = (value) => {
  const text = String(value || "").trim();
  if (!text) return "未定";
  const iso = text.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return iso ? Number(iso[1]) + "/" + Number(iso[2]) : text;
};

export default function PlanBoardCard({ entry, number, data, dates, status, statusTitle, active, references,
  Textarea, onChange, onOpenReferences, onScript, onMoveUp, onMoveDown, canMoveUp, canMoveDown, onDelete,
  score, gradeColor, mono, broken, children, referenceEditor }) {
  const [allReferences, setAllReferences] = useState(false);
  const [editingReferences, setEditingReferences] = useState(false);
  const dialog = useRef(null);
  const intentDialog = useRef(null);
  const [copyStatus, setCopyStatus] = useState("");
  const plan = data && data.plans && data.plans[0];
  const title = plan && plan.title || "";
  const displayTitle = title || entry.name || "タイトル未設定";
  useEffect(() => {
    if (editingReferences && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [editingReferences]);
  const openEditor = () => { setEditingReferences(true); onOpenReferences(); };
  const copySkill = async () => {
    const prompt = "以下の企画メモから、次の企画にも使えるスキルをSKILL.md形式で作成してください。企画固有の事実と一般化できる判断基準・手順を分け、未確定事項を事実にしないでください。クライアント名や個人情報は除いてください。元のメモは変更しないでください。\n\n企画：" + displayTitle + "\n\n" + JSON.stringify({企画の核:plan && plan.storyCore, 視聴者に届けるもの:plan && plan.viewerPromise, 物語の流れ:plan && plan.storyFlow, 企画元:plan && plan.inspirationSources, 元素材:plan && plan.sourceMaterials, 補足:plan && plan.note, 参考動画:(plan && plan.refs || []).filter((r) => r.vid).map((r) => ({title:r.title, url:r.url,参考にする点:r.note}))}, null, 2);
    try { await navigator.clipboard.writeText(prompt); setCopyStatus("コピーしました。ClaudeやGPTに貼り付けてください。"); }
    catch { setCopyStatus("コピーできませんでした。メモを選択してコピーしてください。"); }
  };
  const closeEditor = () => { dialog.current.close(); setEditingReferences(false); };
  return (
    <section className={"mg-plan-card" + (active ? " is-active" : "")} data-plan-case={entry.id} data-toc={displayTitle}>
      <div className="mg-plan-meta">
        <span className="mg-plan-number">企画 #{String(number).padStart(2, "0")}</span>
        <span className="mg-plan-status" title={statusTitle}>{status}</span>
        <button type="button" className="mg-plan-script" onClick={onScript} aria-label={displayTitle + "の構成台本へ"}>
          <span className="mg-plan-script-full">構成台本へ →</span><span className="mg-plan-script-short">台本へ →</span>
        </button>
        <details className="mg-plan-actions">
          <summary aria-label={displayTitle + "の操作"} title="並び替え・削除">⋯</summary>
          <div className="mg-plan-actions-menu">
            <button type="button" disabled={!canMoveUp} onClick={onMoveUp}>上へ移動</button>
            <button type="button" disabled={!canMoveDown} onClick={onMoveDown}>下へ移動</button>
            <button type="button" className="mg-plan-delete" onClick={onDelete}>この企画を削除</button>
          </div>
        </details>
      </div>
      {data ? <Textarea value={title} onChange={(e) => onChange("title", e.target.value)}
        placeholder={entry.name || "タイトル案"} title="今回の企画タイトル" minHeight={26} rows={1} singleLine className="mg-plan-title" />
        : <div className="mg-plan-title">{entry.name}（{broken ? "本体データなし" : "読み込み中…"}）</div>}
      {data && <div className="mg-plan-copies">
        {[["thumbText", "①"], ["thumbText2", "②"]].map(([key, label]) => <label key={key} className="mg-plan-copy">
          <span>サムネ文言{label}</span><input aria-label={displayTitle + "のサムネ文言" + label}
            value={plan && plan[key] || ""} onChange={(e) => onChange(key, e.target.value)} placeholder="未入力" title={plan && plan[key] || "サムネ文言" + label} />
        </label>)}
      </div>}
        <div className="mg-plan-dates" aria-label="制作スケジュール">
          {[["shoot", "撮影"], ["draft", "初稿"], ["publish", "投稿"]].map(([key, label]) => (
            <span key={key} title={label + "：" + (dates[key] || "未定")}><span className="mg-plan-date-label">{label}</span> {compactPlanDate(dates[key])}</span>
          ))}
        </div>
      <div className="mg-plan-card-tools"><button type="button" className="mg-plan-brief-open" disabled={!data} onClick={() => { setCopyStatus(""); intentDialog.current.showModal(); }}>企画の意図</button>
      <div className="mg-plan-ref-heading"><span>ベンチマーク</span><button type="button" onClick={openEditor}>参考動画を編集</button></div></div>
      {references.length ? <div className={"mg-plan-reference-grid" + (allReferences ? " is-expanded" : "")}>
        {references.map((ref, i) => {
          const scored = ref.uploadDate ? score(ref, Date.now()) : null;
          return <button type="button" key={i} className="mg-plan-reference" onClick={openEditor} title={ref.title || "参考動画を編集"}>
            <span className="mg-plan-thumbnail"><img src={"https://img.youtube.com/vi/" + ref.vid + "/mqdefault.jpg"} alt={ref.title || "参考動画のサムネイル"} />
              {scored && <span className="mg-plan-grade" style={{ background: gradeColor[scored.grade] }}>{scored.grade}</span>}
              {ref.duration && <span className="mg-plan-duration" style={{ fontFamily: mono }}>{ref.duration}</span>}
            </span><span className="mg-plan-reference-title">{ref.title || "タイトル未取得"}</span>
          </button>;
        })}
      </div> : <button type="button" className="mg-plan-empty" onClick={openEditor}>＋ 参考動画を追加</button>}
      {references.length > 1 && <button type="button" className="mg-plan-reference-toggle" aria-expanded={allReferences} onClick={() => setAllReferences((v) => !v)}>
        {allReferences ? "参考動画を閉じる −" : "参考動画を見る · 全" + references.length + "本 ＋"}
      </button>}
      {children}
      <dialog ref={intentDialog} className="mg-plan-dialog mg-plan-intent" aria-label={displayTitle + "の企画の意図"}>
        <div className="mg-plan-dialog-heading"><strong>企画の意図</strong><button type="button" onClick={() => intentDialog.current.close()}>閉じる</button></div>
        <div className="mg-plan-dialog-title">{displayTitle}</div>
        <p className="mg-plan-intent-help">企画・ベンチマーク・チャンネルの世界観をつなげて整理します。入力内容は保存され、企画一覧の共有にも表示されます。</p>
        <div className="mg-plan-brief-grid">
          <label><span>企画の核・問い</span><Textarea value={plan && plan.storyCore || ""} onChange={(e) => onChange("storyCore", e.target.value)} rows={2} minHeight={72} aria-label="企画の核・問い" placeholder="例：なぜ諦めかけたのか？何を乗り越える物語か？" /></label>
          <label><span>視聴者に届けるもの</span><Textarea value={plan && plan.viewerPromise || ""} onChange={(e) => onChange("viewerPromise", e.target.value)} rows={2} minHeight={72} aria-label="視聴者に届けるもの" placeholder="見終わった人に、どんな気づきや感情を持ち帰ってほしい？" /></label>
          <label><span>物語の流れ</span><Textarea value={plan && plan.storyFlow || ""} onChange={(e) => onChange("storyFlow", e.target.value)} rows={3} minHeight={104} aria-label="物語の流れ" placeholder="始まり → 壁・葛藤 → 転機 → 結果。まだ未定の部分は未定のままでOK。" /></label>
          <details className="mg-plan-source-details"><summary>企画元・元素材を登録（任意）</summary><div className="mg-plan-source-grid">
            <label><span>企画元・参考にした企画</span><Textarea value={plan && plan.inspirationSources || ""} onChange={(e) => onChange("inspirationSources", e.target.value)} rows={2} minHeight={72} aria-label="企画元・参考にした企画" placeholder="動画URLや企画のきっかけ" /></label>
            <label><span>元素材・関連資料</span><Textarea value={plan && plan.sourceMaterials || ""} onChange={(e) => onChange("sourceMaterials", e.target.value)} rows={2} minHeight={72} aria-label="元素材・関連資料" placeholder="Driveや素材フォルダのURL" /></label>
          </div></details>
          <label><span>企画の補足メモ</span><Textarea value={plan && plan.note || ""} onChange={(e) => onChange("note", e.target.value)} rows={4} minHeight={128} className="mg-plan-intent-text" aria-label="企画の補足メモ" placeholder="企画元・元素材・Claudeへの追加指示など、自由に記録" /></label>
        </div>
        <button type="button" className="mg-plan-skill-copy" disabled={!(plan && plan.note && plan.note.trim())} onClick={copySkill}>スキル化用にコピー</button>
        <p role="status" className="mg-plan-intent-help">{copyStatus}</p>
      </dialog>
      <dialog ref={dialog} className="mg-plan-dialog" aria-label={displayTitle + "の参考動画を編集"}
        onCancel={() => setEditingReferences(false)} onClose={() => setEditingReferences(false)}>
        <div className="mg-plan-dialog-heading"><strong>参考動画を編集</strong><button type="button" onClick={closeEditor}>閉じる</button></div>
        <div className="mg-plan-dialog-title">{displayTitle}</div>
        {editingReferences && (referenceEditor || <p>企画を読み込み中…</p>)}
      </dialog>
    </section>
  );
}

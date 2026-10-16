import React, { useState } from "react";

const excerpt = (value, length = 100) => (value || "").replace(/\s+/g, " ").trim().slice(0, length);

export function workflowSections(project) {
  if (project.format === "talk") {
    const talk = project.talk || {};
    return [
      { id: "talk-highlight", title: "ハイライト", story: talk.highlight },
      { id: "talk-intro", title: "冒頭", story: talk.intro },
      ...(talk.toc || []).map((item, i) => ({ id: `talk-toc-${i}`, title: `目次 ${i + 1}`, story: item })),
      ...(talk.body || []).map((item, i) => ({ id: item.id || `talk-body-${i}`, title: item.heading || `本編 ${i + 1}`, story: item.script })),
      { id: "talk-cta", title: "締め・CTA", story: talk.cta },
    ];
  }
  let location = "";
  return (project.rows || []).flatMap((row, i) => {
    if (row.kind === "location") { location = row.label || "ロケーション"; return []; }
    if (row.kind !== "scene") return [];
    return [{ id: row.id || `scene-${i}`, title: row.label || `セクション ${i + 1}`, location, story: row.script, type: row.type }];
  });
}

export default function EditWorkflow({ project, setProject, setTab, readOnly = false }) {
  const sections = workflowSections(project);
  const workflow = project.editWorkflow || { overall: "", sections: {} };
  const notes = workflow.sections || {};
  const [selected, setSelected] = useState(null);
  const [copied, setCopied] = useState(false);
  const active = sections.find((section) => section.id === selected) || sections[0];
  const activeNote = active ? (notes[active.id] || {}) : {};
  const update = (id, field, value) => setProject((prev) => {
    const current = prev.editWorkflow || { overall: "", sections: {} };
    return { ...prev, editWorkflow: { ...current, sections: { ...(current.sections || {}), [id]: { ...((current.sections || {})[id] || {}), [field]: value } } } };
  });
  const updateOverall = (value) => setProject((prev) => ({ ...prev, editWorkflow: { ...(prev.editWorkflow || {}), overall: value, sections: (prev.editWorkflow && prev.editWorkflow.sections) || {} } }));
  const copyInstructions = async () => {
    const lines = [`# ${project.name || "案件"} 編集構成表`, `全体方針: ${workflow.overall || "未設定"}`, ""];
    sections.forEach((section, i) => {
      const note = notes[section.id] || {};
      lines.push(`${i + 1}. ${section.title}${section.location ? ` / ${section.location}` : ""}`);
      lines.push(`話す内容・台本: ${section.story || "未設定"}`);
      lines.push(`このセクションで伝えること: ${note.intent || "未設定"}`);
      lines.push(`使う素材・クリップ: ${note.material || "未設定"}`);
      lines.push(`粗編集（残す・切る・秒数）: ${note.roughCut || "未設定"}`);
      lines.push(`テロップ・演出: ${note.telop || "未設定"}`, "");
    });
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch (_) { setCopied(false); }
  };
  const textarea = "w-full min-h-[84px] rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-stone-800 outline-none focus:border-stone-500 placeholder:text-stone-400";
  return <div className="max-w-[1500px] mx-auto px-1 sm:px-0 py-1 space-y-4">
    <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-[20px] font-bold text-stone-900">編集ワークフロー</h1><p className="mt-1 text-[13px] text-stone-600">構成台本の順番で、各場面の内容と編集指示を確認できます。</p></div>
        <button type="button" onClick={copyInstructions} className="rounded-lg bg-stone-900 px-3 py-2 text-[13px] font-bold text-white">{copied ? "コピーしました" : "編集指示をコピー"}</button>
      </div>
      <p className="mt-3 text-[12px] text-stone-500">ここで保存するのは編集方針です。AIによるカットやテロップ挿入は実行されません。</p>
      <label className="block mt-4 text-[13px] font-bold text-stone-700" htmlFor="editflow-overall">全体の編集方針</label>
      <textarea id="editflow-overall" className={textarea + " mt-1.5"} value={workflow.overall || ""} onChange={(e) => updateOverall(e.target.value)} placeholder="例：テンポは自然に。間は少し残し、言い直しだけ切る。テロップは強調箇所に絞る" readOnly={readOnly} />
    </div>
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,0.95fr)_minmax(0,1.4fr)] items-start">
      <div className="rounded-2xl border border-stone-200 bg-white overflow-hidden">
        <div className="px-4 py-3 border-b border-stone-100 font-bold text-stone-800">構成表 <span className="text-stone-500 text-[12px] font-normal">{sections.length}セクション</span></div>
        {sections.length ? <div className="max-h-[70vh] overflow-y-auto divide-y divide-stone-100">{sections.map((section, i) => {
          const note = notes[section.id] || {};
          return <button type="button" key={section.id} onClick={() => setSelected(section.id)} aria-current={active && active.id === section.id ? "true" : undefined} className={"w-full text-left px-4 py-3 hover:bg-stone-50 " + (active && active.id === section.id ? "bg-stone-100" : "")}>
            <div className="flex items-start gap-2"><span className="shrink-0 w-6 h-6 rounded-md bg-stone-200 text-stone-700 text-[12px] font-bold grid place-items-center">{i + 1}</span><div className="min-w-0"><div className="font-bold text-[14px] text-stone-900">{section.title}</div>{section.location && <div className="text-[11px] text-stone-500">{section.location}</div>}</div></div>
            <p className="mt-1.5 text-[12px] text-stone-600 line-clamp-2">{excerpt(note.intent || section.story) || "話す内容は構成台本から設定"}</p>
            <div className="mt-1 text-[11px] text-stone-500">{[note.material && "素材", note.roughCut && "粗編集", note.telop && "テロップ"].filter(Boolean).join("・") || "編集指示は未入力"}</div>
          </button>;
        })}</div> : <p className="px-4 py-5 text-[13px] text-stone-500">構成台本にセクションを追加すると、ここに表示されます。</p>}
      </div>
      {active && <div className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 space-y-4" key={active.id}>
        <div><p className="text-[11px] font-bold text-stone-500">選択中のセクション</p><h2 className="text-[18px] font-bold text-stone-900">{active.title}</h2>{active.location && <p className="text-[12px] text-stone-500">{active.location}</p>}</div>
        <div className="rounded-xl bg-stone-50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[12px] font-bold text-stone-600">構成台本の内容</span><button type="button" onClick={() => setTab("script")} className="text-[12px] font-bold underline text-stone-700">台本を開く</button></div><p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-stone-700">{active.story || "まだ入力されていません"}</p></div>
        {[["intent", "このセクションで伝えること", "例：仕事を始めた理由と、その時の迷いを見せる"], ["material", "使う素材・クリップ", "例：インタビューA 01:20〜、現場Bの手元カット"], ["roughCut", "粗編集の指示", "例：冒頭の言い直しだけ切る。02:13.4〜02:13.6を0.2秒カット。笑う間は残す"], ["telop", "テロップ・演出の指示", "例：結論の一文だけ大きく。固有名詞は白字幕"]].map(([field, label, placeholder]) => <label key={field} className="block"><span className="text-[13px] font-bold text-stone-700">{label}</span><textarea className={textarea + " mt-1.5"} value={activeNote[field] || ""} onChange={(e) => update(active.id, field, e.target.value)} placeholder={placeholder} readOnly={readOnly} /></label>)}
      </div>}
    </div>
  </div>;
}

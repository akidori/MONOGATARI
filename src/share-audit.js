// 共有前に端末内だけで実行する決定的監査。AI・ネットワーク・定期実行は使わない。
export function auditShareProject(project, dayOf) {
  const issues = [];
  const rows = (project && project.rows) || [];
  const getDay = typeof dayOf === "function" ? dayOf : (row) => row.day || 1;
  const toMin = (time) => {
    const match = /^(\d{1,2}):(\d{2})/.exec((time || "").trim());
    return match ? (+match[1]) * 60 + (+match[2]) : null;
  };
  let prevTime = null;
  let prevDay = null;

  rows.forEach((row) => {
    if (row.kind === "location") {
      if (!(row.label || "").trim()) issues.push({ category: "ロケ漏れ", detail: "ロケーション名が空のままです", rowId: row.id, sceneLabel: "（ロケ名未入力）" });
      const currentDay = getDay(row);
      const time = toMin(row.time);
      if (time != null) {
        if (prevTime != null && prevDay === currentDay && time < prevTime) {
          issues.push({ category: "撮影順", detail: "撮影時刻（" + row.time + "）が前のロケ（" + Math.floor(prevTime / 60) + ":" + String(prevTime % 60).padStart(2, "0") + "）より早くなっています", rowId: row.id, sceneLabel: row.label });
        }
        prevTime = time;
        prevDay = currentDay;
      } else if (prevDay !== currentDay) {
        prevTime = null;
        prevDay = currentDay;
      }
      return;
    }

    const label = (row.label || "").trim();
    const lines = (row.script || "").split("\n").map((line) => line.trim()).filter(Boolean);
    if (!label) issues.push({ category: "シーン漏れ", detail: "シーンタイトルが空のままです", rowId: row.id, sceneLabel: "（無題のシーン）" });
    if (row.type === "インサート" && !lines.some((line) => !/^[※★◼■>＞]/.test(line))) {
      issues.push({ category: "インサート不足", detail: "撮るカットが1つも書かれていません（1行＝1カット）", rowId: row.id, sceneLabel: label || "（無題）" });
    }
    let openQuestion = null;
    let emptyQuestions = 0;
    lines.forEach((line) => {
      if (/^[◼■]/.test(line)) {
        if (openQuestion) emptyQuestions++;
        openQuestion = line;
      } else if (openQuestion && !/^[※★>＞]/.test(line)) {
        openQuestion = null;
      }
    });
    if (openQuestion) emptyQuestions++;
    if (emptyQuestions) issues.push({ category: "回答なし", detail: "回答が空の質問が " + emptyQuestions + " 件あります（撮影前なら問題ありません）", rowId: row.id, sceneLabel: label || "（無題）", soft: true });
  });

  return issues;
}

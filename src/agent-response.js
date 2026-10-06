/* agent/PROMPT.md の出力契約を検証する。知識の正しさとは別の形式検証。 */
export function parseAgentResponse(text) {
  const invalid = (error) => ({ verdict: null, fields: {}, error });
  if (typeof text !== "string" || !text.trim()) return invalid("EMPTY_RESPONSE");
  const lines = text.trimStart().split(/\r\n|[\r\n\u2028\u2029]/); // 終端の空白種別を検証するため末尾を削らない
  const head = /^判定[:：][ \t]*(回答|AKへ)[ \t]*$/.exec(lines[0]);
  if (!head) return invalid("INVALID_VERDICT_HEADER");
  const verdict = head[1], fields = {};
  let current = null, fence = null;
  for (const line of lines.slice(1)) {
    // 引用コード内のラベルはデータ。コードブロック全体で返された回答は先頭検証で拒否する。
    const code = /^\s*(`{3,}|~{3,})/.exec(line);
    if (code) {
      if (!fence) fence = code[1];
      else {
        // 終端は独立した同種・同数以上のフェンスと末尾の空白/タブだけ。
        // ```suffix は引用内容であり、閉じたことにして判定や通知へ進めない。
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
        if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
      }
    }
    if (!fence && !code && /^[ \t]*判定[:：]/.test(line)) return invalid("DUPLICATE_VERDICT");
    const header = !fence && !code && /^(判定|回答|出典|AKへの理由|資料にある手順|AKに渡す質問文)[:：][ \t]*(.*)$/.exec(line);
    if (header) {
      if (header[1] === "判定") return invalid("DUPLICATE_VERDICT");
      if (Object.hasOwn(fields, header[1])) return invalid("DUPLICATE_FIELD");
      current = header[1]; fields[current] = header[2];
    } else if (current) fields[current] += "\n" + line;
    else if (line.trim()) return invalid("UNEXPECTED_PREAMBLE");
  }
  if (fence) return invalid("UNCLOSED_QUOTE");
  const required = verdict === "回答" ? ["回答", "出典"] : ["AKへの理由", "AKに渡す質問文"];
  const forbidden = verdict === "回答" ? ["AKへの理由", "AKに渡す質問文", "資料にある手順"] : ["回答", "出典"];
  if (forbidden.some((key) => Object.hasOwn(fields, key))) return invalid("CONFLICTING_FIELDS");
  if (required.some((key) => !fields[key]?.trim())) return invalid("MISSING_REQUIRED_FIELD");
  return { verdict, fields, error: null };
}

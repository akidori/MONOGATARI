// Inline formatting helpers shared by the editor and its regression tests.
// Stored format remains compatible with existing project data: **bold** / !!red!!.
export function buildStyledRuns(text) {
  const runs = [];
  let bold = false, red = false, buf = "", bBold = false, bRed = false;
  const flush = () => { if (buf) { runs.push({ text: buf, bold: bBold, red: bRed }); buf = ""; } };
  for (let i = 0; i < text.length; ) {
    if (text[i] === "*" && text[i + 1] === "*") { flush(); runs.push({ text: "**", marker: true }); bold = !bold; i += 2; continue; }
    if (text[i] === "!" && text[i + 1] === "!") { flush(); runs.push({ text: "!!", marker: true }); red = !red; i += 2; continue; }
    if (!buf) { bBold = bold; bRed = red; }
    buf += text[i]; i++;
  }
  flush();
  return runs;
}

// Apply/remove a marker without ever nesting the same marker repeatedly.
// The toolbar keeps the body selected, so clicking the same button again removes it.
export function toggleInlineMarker(value, selectionStart, selectionEnd, marker) {
  const text = value || "";
  const start = Math.max(0, selectionStart || 0);
  const end = Math.max(start, selectionEnd == null ? start : selectionEnd);

  if (end > start && text.slice(start - marker.length, start) === marker && text.slice(end, end + marker.length) === marker) {
    return {
      value: text.slice(0, start - marker.length) + text.slice(start, end) + text.slice(end + marker.length),
      start: start - marker.length,
      end: end - marker.length,
    };
  }

  if (end > start && text.slice(start, start + marker.length) === marker && text.slice(end - marker.length, end) === marker) {
    return {
      value: text.slice(0, start) + text.slice(start + marker.length, end - marker.length) + text.slice(end),
      start,
      end: end - marker.length * 2,
    };
  }

  const selected = end > start ? text.slice(start, end) : "ここ";
  return {
    value: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + marker.length,
    end: start + marker.length + selected.length,
  };
}

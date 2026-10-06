// Malformed endings must leave the quotation open, even when it contains verdict lines.
export const invalidFenceResponses = ['```not-a-closing-fence', '``` text', '```~', '```\u3000', '    ```', '\t```', '``', '~~~'].map((end) =>
  '判定: AKへ\nAKへの理由: UNSAFE_RAW\n```text\n判定: 不明\n' + end + '\nAKに渡す質問文: 質問');
invalidFenceResponses.push('判定: AKへ\nAKへの理由: UNSAFE_RAW\n~~~text\n判定: 回答\n~~~suffix\nAKに渡す質問文: 質問');
export const validFenceResponses = ['```', '````', '   ``` \t', '```not-a-closing-fence\n```'].map((end) =>
  '判定: AKへ\nAKへの理由: 合成引用\n```text\n判定: 不明\n' + end + '\nAKに渡す質問文: 質問');
validFenceResponses.push('判定: 回答\n回答: 合成引用\n~~~text\n判定: AKへ\n~~~~ \t\n出典: 合成資料');
invalidFenceResponses.push('判定: AKへ\nAKへの理由: UNSAFE_RAW\nAKに渡す質問文: 質問\n```text\n判定: 不明\n```\u3000');

export const ambiguousVerdictResponses = ['\u2028', '\u2029', '\r', ' ', '\t'].map((prefix) =>
  '判定: AKへ\nAKへの理由: UNSAFE_RAW\n' + prefix + '判定: 回答\nAKに渡す質問文: 質問');
ambiguousVerdictResponses.push('判定: AKへ\nAKへの理由: UNSAFE_RAW\n 判定: 不明\nAKに渡す質問文: 質問');

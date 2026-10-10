/* ===== はじめてガイド（2026-10-10 AK「スタートアップURLを送ったらエージェントが出てきて、質問や使い方をURLや動画、文章、画像で教えてくれる」）=====
   URL：<アプリのURL>#start（特定の項目は #start=<id>）。ログイン不要で開ける。質問はログインすると AI（/api/agent/ask）に聞ける。
   ここは中身（項目）と、純粋な関数だけ。画面は monogataritch.src.jsx の StartGuide。テストは tools/test-start-guide.mjs。
   項目を足す・動画や画像を差し替える時は START_TOPICS だけを直す（video に YouTube などのURL、image に guide/ 配下の画像）。
   書く内容は、実際の画面の言葉に合わせる（画面に無い機能を書かない）。 */

export const START_HASH = "#start";

/* 項目：id／title／summary（一言）／keywords（質問からの当てはめ用）／steps（手順）／points（つまずきやすい所）／
   image（guide/ の画像。無ければ空）／video（YouTube などのURL。無ければ空）／links（[{label,url}]）／open（アプリ内で開く先） */
export const START_TOPICS = [
  {
    id: "script", title: "構成を確認する", summary: "構成台本を見て、直す。提出の前に自分で採点もできる",
    keywords: ["構成", "台本", "確認", "採点", "ズレ", "セクション", "インサート", "訴求", "ブリッジ", "VLOG", "解説系", "★", "取り込み", "変更履歴"],
    steps: [
      "ホームの「構成を確認する」を押して、案件を選ぶ（あなたの担当・最近開いた案件が上に出る）",
      "「構成台本」タブが開く。上の帯に、尺・シーン合計・字/秒が出る",
      "各シーンの種類（インサート／ブリッジ／VLOG／解説系／訴求）と秒数、★（仮置きのセリフ）を見る",
      "出す前に、上の帯の「構成の採点」を押す。数えて分かること（種類・秒数・文字数など）はすぐ出る",
      "「今回の採点に使う物語タイプ」を選んで「AIで採点する」を押すと、構成のルールとマニュアルに照らした採点が出る",
      "指摘の「#4」のような番号を押すと、そのシーンに移動する",
    ],
    points: [
      "★は、Claudeが仮置きしたセリフ。撮影当日に本人の言葉で引き出す（撮影前に聞いて埋めない）",
      "誤字・内容の重複・質問と回答の逆転は、行メニューの「AI校正チェック」で見られる",
    ],
    image: "guide/script.jpg", video: "", links: [], open: { tab: "script", needsCase: true },
  },
  {
    id: "video", title: "動画をアップする", summary: "書き出した動画を出して、修正コメントを見る",
    keywords: ["動画", "アップ", "mp4", "YouTube", "限定公開", "修正", "コメント", "倍速", "確認", "書き出し", "出す"],
    steps: [
      "ホームの「動画をアップする」を押して、案件を選ぶ",
      "「動画確認」タブで、「mp4をアップロード」を押す（ドラッグ＆ドロップでもよい）。YouTube限定公開のURLを貼って「登録」でもよい",
      "上がった動画は、0.5〜4倍速で試写しながら、気になる所に修正コメントを付けられる",
      "先方に見てもらう時は、「確認URLをコピー」で出るURLを送る",
    ],
    points: [
      "アップの枠が出ない時は、閲覧用のリンクを開いている可能性がある。編集者用のリンクから開き直す",
    ],
    image: "guide/video.jpg", video: "", links: [], open: { tab: "review", needsCase: true },
  },
  {
    id: "assets", title: "素材を入れる・渡す", summary: "撮影素材や資料を案件に入れる。URL1本で渡すこともできる",
    keywords: ["素材", "ファイル", "資料", "ダウンロード", "渡す", "受け取り", "転送", "アップロード", "撮影素材"],
    steps: [
      "ホームの「素材を入れる」を押して、案件を選ぶ",
      "「素材管理」タブにファイルを入れる",
      "相手にURLで渡す時は、素材を選んで「URLで渡す」、相手から受け取る時は「受け取りURLを作る」を押す",
    ],
    points: ["編集者がアップしたものは、素材管理タブを開くと自動で取り込まれる"],
    image: "", video: "", links: [], open: { tab: "assets", needsCase: true },
  },
  {
    id: "ask", title: "質問する", summary: "台本・撮影・編集で迷ったら、AIに聞く。答えられないことはAKさんに回る",
    keywords: ["質問", "聞く", "迷", "AI", "エージェント", "わからない", "分からない", "どうすれば", "AK", "回答", "お金", "日程", "先方"],
    steps: [
      "ホームの「質問する」（または右上の「AIに質問」）を押す",
      "案件を開いたまま聞くと、その案件の資料（台本・取材メモ・NG）も見て答える",
      "お金・日程・先方への対応・構成の変更・センシティブな判断は、AIは答えずにAKさんへ確認が回る",
      "AKさんが答えると、右上のベル（通知）に「AKさんから回答」が届く",
    ],
    points: [
      "答えには、出典（マニュアルのどの節か）が付く",
      "同じ種類の質問には、AKさんの回答をもとにAIが次から答えられるようになる",
    ],
    image: "guide/ask.jpg", video: "", links: [], open: { ask: true },
  },
  {
    id: "new", title: "新しい案件をつくる", summary: "一日密着・トークなどの案件を作る",
    keywords: ["新規", "新しい", "案件", "作る", "つくる", "追加", "トーク", "密着", "チャンネル"],
    steps: [
      "ホームの「新しい案件をつくる」を押して、種類（一日密着・トークなど）を選ぶ",
      "「概要」タブで、案件名・チャンネル・撮影日などを入れる",
      "編集者用のリンクを出す前に、必須の6項目が空欄だと警告が出る。空欄のまま渡す時は、確認してから進む",
    ],
    points: ["チャンネル（クライアント）は、ホームの検索欄の横の「フォルダ＋」ボタンから追加できる"],
    image: "", video: "", links: [], open: { newCase: true },
  },
  {
    id: "today", title: "今日やることを見る", summary: "担当の工程と、自分で足したTODOをホームの上で確認する",
    keywords: ["今日", "TODO", "やること", "担当", "納期", "締切", "工程", "遅れ", "タスク"],
    steps: [
      "ホームを開くと、いちばん上の「今日やること」に、担当の工程のうち遅れ・今日・もうすぐのものが並ぶ",
      "自分でも、入力欄にやることを書いて Enter で足せる。チェックを入れると完了になる",
      "全体の担当と納期は、左のメニューの「担当と納期」で見られる",
    ],
    points: ["担当の工程は、Studio OS と連携していると出る。出ない時は、AKさんに連携を確認してもらう"],
    image: "", video: "", links: [], open: {},
  },
  {
    id: "learn", title: "工程ごとのマニュアル（学習）", summary: "編集の工程ごとのやり方と、困った時の手順をまとめたページ",
    keywords: ["学習", "マニュアル", "やり方", "手順", "工程", "編集", "テロップ", "音声", "素材整理", "初稿", "修正", "ルール"],
    steps: [
      "ホーム左下の「学習」（スマホは、この案内の「やってみる」）から開く",
      "左の一覧から、いまの工程や困りごとの項目を選ぶ",
      "手順・つまずきやすい点・よくある困りごとが出る。動画がある項目は、そのまま見られる",
    ],
    points: ["項目は、工程ごとのマニュアルをもとに、少しずつ増えている"],
    image: "", video: "", links: [], open: { learn: true },
  },
  {
    id: "login", title: "ログインと通知", summary: "ログインすると案件がクラウドに保存され、どの端末でも開ける",
    keywords: ["ログイン", "アカウント", "通知", "ベル", "招待", "保存", "端末", "パスワード"],
    steps: [
      "右上の「ログイン」から入る。ログインすると、案件がクラウドに保存されて、どの端末でも開ける",
      "右上のベルに、締切のお知らせ・AKさんからの回答などが届く",
    ],
    points: ["ログインしていないと、AIへの質問と、案件のクラウド保存は使えない"],
    image: "", video: "", links: [], open: { account: true },
  },
];

/* アプリのURLから、はじめてガイドのURLを作る（#start、項目指定は #start=<id>） */
export function startUrl(origin, pathname = "/", topicId = "") {
  const base = String(origin || "").replace(/\/$/, "") + String(pathname || "/").replace(/[^/]*$/, "");
  return base + START_HASH + (topicId && START_TOPICS.some((t) => t.id === topicId) ? "=" + topicId : "");
}

/* location.hash が はじめてガイドを指すか。{ open, topic }。#startup など別のものは対象外 */
export function parseStartHash(hash) {
  const m = String(hash || "").match(/^#start(?:=([a-z0-9-]{1,40}))?$/);
  if (!m) return { open: false, topic: "" };
  const topic = m[1] && START_TOPICS.some((t) => t.id === m[1]) ? m[1] : "";
  return { open: true, topic };
}

/* 質問に近い項目を、当てはまりの強い順に最大 n 件。キーワードの含まれる数で数え、0件は出さない */
export function matchTopics(question, n = 2) {
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return [];
  return START_TOPICS
    .map((t) => ({ t, score: t.keywords.reduce((s, k) => s + (q.includes(k.toLowerCase()) ? 1 : 0), 0) + (q.includes(t.title.slice(0, 4)) ? 2 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n).map((x) => x.t);
}

/* 動画・画像・リンクのURLを、出し方に分ける。https のものだけ（javascript: などは弾く）。
   YouTube は埋め込み用のURLに直す（youtube-nocookie）。画像は guide/ 配下の相対パスか https */
export function mediaOf(url) {
  const u = String(url || "").trim();
  if (!u) return null;
  if (/^guide\/[A-Za-z0-9._-]+\.(jpe?g|png|webp|gif|mp4)$/.test(u)) return { kind: /\.mp4$/.test(u) ? "video" : "image", url: u };
  let p;
  try { p = new URL(u); } catch (e) { return null; }
  if (p.protocol !== "https:") return null;
  const host = p.hostname.replace(/^www\./, "");
  let id = "";
  if (host === "youtu.be") id = p.pathname.slice(1);
  else if (host === "youtube.com" || host === "m.youtube.com") {
    if (p.pathname === "/watch") id = p.searchParams.get("v") || "";
    else { const m = p.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/); if (m) id = m[1]; }
  }
  if (id) { if (!/^[A-Za-z0-9_-]{6,20}$/.test(id)) return null; return { kind: "youtube", url: "https://www.youtube-nocookie.com/embed/" + id, watch: "https://www.youtube.com/watch?v=" + id }; }
  if (/\.(mp4|webm)$/i.test(p.pathname)) return { kind: "video", url: u };
  if (/\.(jpe?g|png|webp|gif)$/i.test(p.pathname)) return { kind: "image", url: u };
  return { kind: "link", url: u };
}

/* はじめてガイドで最初に出す、エージェントのあいさつ */
export const START_GREETING = "はじめまして。ものがたりっちの案内役です。やりたいことを選ぶか、困っていることをそのまま書いてください。手順と画面、動画で案内します。";

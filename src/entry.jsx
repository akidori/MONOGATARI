import React from "react";
import { createRoot } from "react-dom/client";
import App, { CreatorPublicPage } from "../monogataritch.src.jsx";

// 共有URL（#creator=…）はログイン不要のプロフィールページだけを出す（クリエイタータイプ診断）
const isCreatorProfile = (window.location.hash || "").startsWith("#creator=");
createRoot(document.getElementById("root")).render(isCreatorProfile ? <CreatorPublicPage /> : <App />);

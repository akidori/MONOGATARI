/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./monogataritch.src.jsx", "./*.html"],
  theme: {
    extend: {
      // 和文は字面が詰まっているので、欧文前提の字間（wider=0.05em, widest=0.1em）だと
      // 文字がバラけて単語のまとまりが崩れ、かえって読みにくい。和文向けに控えめへ（2026-09-21）
      letterSpacing: { wide: "0.02em", wider: "0.04em", widest: "0.08em" },
    },
  },
  plugins: [],
};

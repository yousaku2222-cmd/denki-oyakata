# CLAUDE.md

でんきの親方 — 電気工事のベテランの知恵を若手へ受け継ぐ Web アプリ（Built with Claude: Japan 2026）。仕様は SPEC.md、設計は docs/design.md。

## 構成
- `web/` Vite + React + TypeScript（スマホ画面、PWA）
- `functions/` Firebase Functions (TypeScript)。Claude API はここからだけ呼ぶ。APIキーは Secret `ANTHROPIC_API_KEY`、未設定ならダミー応答で動く。呼び出しは匿名ログイン必須、uid はトークンからだけ取る。Claude の呼び出しと共有への書き込みは1日の上限あり（`limits.ts`、端末・回線・全体）。審査員モードは `spaceOf`（`trial_<uid>`）で本人にだけ見せる
- Firestore。クライアントは読むだけ、書き込みはすべて Functions 経由（firestore.rules）

## コマンド（Node は PATH に `/c/Program Files/nodejs`、firebase は `/c/Users/優作（積算用）/AppData/Roaming/npm` を足す）
- `cd functions && npm run build` / `npm test`
- `cd web && npm run build` / `npm run dev`
- `firebase emulators:start --project demo-denki-oyakata`（ルートで。Functions は先に build。Java 21 が要る: `JAVA_HOME=/c/dev/tools/jdk-21.0.12.1+1`）
- `node scripts/e2e.mjs` — エミュレータ起動中に、話す→カード→聞く→質問箱→答える の一周を確認

## 決まり
- モデル名は `functions/src/models.ts` の役割ごとの定数だけで指定する（ROUTER=Haiku / ANSWER=Sonnet / HEAVY=Opus）
- 計算・判定はプログラムで行い、AI に計算させない
- 法令の引用は原文との照合を通ったものだけ「✔」を付ける
- 画面の文言は日本語。コメント・コミットは英語可
- 個人情報（お客様名・住所）や他社の資料本文をリポジトリに入れない

# 設計（全部入りのデータの形。作るのは段階ごと）

## 1. データの形（Firestore）

全ドキュメントに `companyId`（今は `"demo"` 固定。将来の複数社対応）。日時は Firestore Timestamp。

### cards（知恵カード）
| 項目 | 型 | 説明 |
|---|---|---|
| title | string | 一言でいうと |
| scene | string | どんな現場・場面で |
| body | string | やり方・コツ |
| reason | string | なぜそうするか／やらかした失敗 |
| caution | string | 新人がよく間違えること |
| relatedLaws | string[] | 関係しそうな決まり（例「解釈 第158条」）。段階2で法令カードと結ぶ |
| tags | string[] | 検索用の言い換え・現場の呼び名 |
| category | 'piping'\|'wiring'\|'grounding'\|'license'\|'calc'\|'safety'\|'other' | 種類 |
| location | 'ceiling'\|'floor'\|'outdoor'\|'panel'\|'other' | 場所 |
| authorName | string | 表示名（名前を出すと選んだ時だけ。出さない時は空。書いた人の端末ID・本名は cardPrivate） |
| showAuthorName | boolean | 名前を出すか（公開時に本人が選ぶ） |
| status | 'draft'\|'published'\|'private' | 本人確認までは draft |
| visibility | 'company'\|'region'\|'national' | 公開範囲（初期値 company。今回は company のみ使う） |
| region / powerCompany | string\|null | どの地域・電力会社の現場で通じる知恵か |
| confirmations | {name, at}[] | 確かめたベテラン（表示名と日時だけ。全国公開は複数人を条件にする想定） |
| helpedCount / viewCount | number | 「助かった」数・参照数 |
| triggerQuestionId / triggerAskerName / triggerQuestionText | string\|null | きっかけの質問（本文は検索にも使う） |
| transcript | [] | 常に空（聞き取りのやりとりの原文は cardPrivate に置く。文字だけで、声は残さない） |
| createdAt / updatedAt / publishedAt | Timestamp | |

### questions（質問箱。画面からは直接読めない。openQuestions・questionPhoto・myQuestions で読む）
| 項目 | 型 | 説明 |
|---|---|---|
| text | string | 質問の原文 |
| askerId / askerName / askerRole | string | 聞いた人（端末ID・表示名・young/veteran） |
| excludeVeteranId | string\|null | ベテランが聞いた質問は本人の箱に入れない |
| photo | string\|null | 段階4: 写真ごと質問（1024px 程度の JPEG の data URL、30万字まで。photoUrl は未使用） |
| status | 'open'\|'answered' | |
| goodBy | string[] | 「いい質問」を押したベテラン |
| answeredCardId | string\|null | 答えになったカード |
| createdAt / answeredAt | Timestamp | |

### answers（答えの記録。正答率テスト・振り返り用）
| 項目 | 型 | 説明 |
|---|---|---|
| question / interpretedAs | string | 原文と「こう受け取りました」 |
| sentences | Sentence[] | 一文ずつ |
| grounded | boolean | 法令か知恵の根拠が1つ以上あるか |
| usedCardIds / usedLawIds | string[] | |
| helped | boolean | 若手が「助かった」を押したか |
| askerId / askerRole | string | |
| mode | 'claude'\|'dummy' | |
| models | {router?, answer?} | 使ったモデル |
| createdAt | Timestamp | |

`Sentence = { text, source: 'law'|'wisdom'|'general', cardId?, lawId?, quote?, verified?: boolean }`
- law: 段階2。quote が法令原文に実在するとプログラムが確かめたら verified=true
- wisdom: cardId が実在する公開カードを指す時だけ（プログラムで確認。無ければ general に落とす）
- general: AI の一般知識。「要確認」を付けて表示

### cardPrivate（サーバーだけが読む。firestore.rules で画面からは読めない）
`{ authorId, authorName, transcript, createdAt }` — 書いた人の端末ID・本名・聞き取りのやりとりの原文。公開カード（cards）には端末IDを置かず（名前を伏せたカードと名前を出したカードを結び付けられないように）、名前を出すと選んだ時だけ authorName を入れ、transcript は空にする。この形の前に公開したカードは `scripts/migrate-private.mjs` で移す。

### users（端末ごと。ログインなし）
`{ askedCount, answeredFromMyQuestions }`（いまは数だけ。displayName・roleHistory は将来の「若手→ベテランへの移行」「成長の記録」の土台として予定）

### usage（回数制限の数。サーバーだけ）
`{日付}_{種類}{uid}`・`{日付}_{種類}ip_{回線のハッシュ}`・`{日付}_{種類}all_{0〜9}`（全体の数は10か所に分けて数える）。種類は AI（なし）／質問箱 `box_`／公開 `pub_`／引き継ぎコードを出す `trm_`／入れる `tr_`。断った呼び出しは足した数を戻すので、1台が全体の数に足せるのは自分の上限の分まで。

### transfers（引き継ぎコード。サーバーだけ）
`{ uid, createdAt, expiresAt }` — 24時間・1回だけ。新しいコードを出すと、その端末の前のコードは消える。使うと、古い端末IDのカード・質問・答えの記録が新しい端末IDに移る。

### 法令カード（段階2。Firestore ではなく `functions/data/laws.json` を Functions と一緒に配る）
`{ id, lawName, short, edition, article, heading, text(原文), summary, keywords[], scenes[], sourceUrl }`
Opus が条文ごとに要約・キーワード・場面を付ける（ナレッジウィキ方式）。原文はそのまま持ち、照合に使う。

## 2. Functions（呼び出し口。すべて callable、書き込みは admin SDK）
| 名前 | 段階 | 役割 |
|---|---|---|
| interviewNext | 1 | 聞き取りのやりとりから、次の聞き返し1問か「十分です」を返す |
| draftCard | 1 | やりとりから知恵カードの下書きを作る（保存は draft） |
| publishCard | 1 | 本人が直した内容で公開（名前を出すか、きっかけの質問を結ぶ） |
| setCardStatus | 1 | 非公開にする／戻す |
| ask | 1 | 振り分け → 知恵カード検索 → 3色の答え。根拠なしなら grounded=false |
| sendToBox | 1 | 質問を質問箱へ |
| markHelped / markGoodQuestion | 1 | 貢献の見える化 |
| myCards / myCard / deleteDraft | 1 | 自分のカードの一覧／開いて直す（非公開のカードは非公開のまま）／下書きを消す |
| openQuestions / questionPhoto / myQuestions | 1 | 質問箱の一覧（新しい順に50件、写真なし）／1件の写真／自分が聞いた質問 |
| listCalcs / calc | 3 | 計算・判定（プログラム）。calc は name で計算を選ぶ |
| listLaws / getLaw | 2 | 法令カードの一覧・全文 |
| identifyPart | 4 | 写真の判定 |
| makeTransferCode / useTransferCode | 締め | 端末の引き継ぎ |

回数制限（締め）: 端末ごと・回線ごと・全体の1日上限を Functions で数える（`functions/src/limits.ts`）。先に数を足してから読み、上限を超えていれば断る（トランザクションを使わないので、同時に呼ばれてもロック待ちで失敗しない。上限を超えて通ることはない）。

## 3. 画面
入り口（初回だけ）: ロゴ・キャッチコピー・使い方3コマ・「ベテランとして使う／若手として使う」・「審査員の方はこちら（デモ）」。役割は端末に保存、右上からいつでも切り替え。
- 若手（下タブ5つ）: 聞く／探す／計算（段階3）／撮る（段階4）／わたし
- ベテラン（下タブ4つ）: 聞く・探す（若手と共通部品。根拠なしは他のベテランの箱へ）／話す／質問箱／わたしのカード
- 常に下に「最終判断は有資格者・責任者が行ってください」

見た目: 紺（作業服）＋黄（安全標識）。ボタン高さ56px以上、文字大きめ、明暗切り替え。出どころは色＋アイコン＋文字。

## 4. Claude の使い方（モデルは役割ごとの定数）
| 仕事 | モデル | 理由 |
|---|---|---|
| 質問の振り分け・言い換え（こう受け取りました） | Haiku 5.5（ROUTER） | 短い分類。安く速く |
| 答えづくり（道具: カード検索・条文取得・計算） | Sonnet 5.5（ANSWER） | 会話と道具の使用 |
| 聞き取りの聞き返し・カード化 | Sonnet 5.5（ANSWER） | 会話の質 |
| 写真の判定 | Sonnet 5.5（ANSWER, 画像入力） | |
| 法令カードづくり（1回だけ）・見直し役 | Opus 5.5（HEAVY） | 重い整理・点検 |
| 引用の照合・計算 | プログラム | AI 任せにしない |

APIキーが無い時（ANTHROPIC_API_KEY 未設定）は全関数がダミー応答（mode='dummy'）で一周できる。

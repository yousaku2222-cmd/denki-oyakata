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
| authorId / authorName | string | 書いた人（端末ID）と表示名 |
| showAuthorName | boolean | 名前を出すか（公開時に本人が選ぶ） |
| status | 'draft'\|'published'\|'private' | 本人確認までは draft |
| visibility | 'company'\|'region'\|'national' | 公開範囲（初期値 company。今回は company のみ使う） |
| region / powerCompany | string\|null | どの地域・電力会社の現場で通じる知恵か |
| confirmations | {by, name, at}[] | 確かめたベテラン（全国公開は複数人を条件にする想定） |
| helpedCount / viewCount | number | 「助かった」数・参照数 |
| triggerQuestionId / triggerAskerName / triggerQuestionText | string|null | きっかけの質問（本文は検索にも使う） |
| transcript | {role:'veteran'\|'ai', text}[] | 聞き取りのやりとり（文字だけ。声は残さない） |
| createdAt / updatedAt / publishedAt | Timestamp | |

### questions（質問箱）
| 項目 | 型 | 説明 |
|---|---|---|
| text | string | 質問の原文 |
| askerId / askerName / askerRole | string | 聞いた人（端末ID・表示名・young/veteran） |
| excludeVeteranId | string\|null | ベテランが聞いた質問は本人の箱に入れない |
| photoUrl | string\|null | 段階4: 写真ごと質問 |
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

### users（端末ごと。ログインなし）
`{ displayName, roleHistory: {role, at}[], askedCount, answeredFromMyQuestions, helpedCount, createdAt }`
将来の「若手→ベテランへの移行」「成長の記録」の土台。

### laws（段階2: 法令カード）
`{ lawName, edition, article, heading, text(原文), summary, keywords[], scenes[], sourceUrl }`
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
| calc* | 3 | 計算・判定（プログラム） |
| identifyPhoto | 4 | 写真の判定 |

回数制限（`functions/src/limits.ts`）: Claude を呼ぶ処理を、端末（匿名 uid）ごと40・回線（X-Forwarded-For を右から読んだ通信元のハッシュ）ごと120・全体600回分で数える。写真は2回分＋写真だけの全体150回。カードの公開と質問箱への送信は端末ごと20・回線ごと60件。同じ質問（空白・句読点・全角半角をそろえたもの）は、カードの一覧とデプロイが同じ間、保存した答え（`askCache`）を返して回数に数えない。
審査員モード: 入口の「審査員の方はこちら」から入ると、カード・質問を `companyId = trial_<uid>` に置き、その端末にだけ見せる（`spaceOf`）。試用のカードで共有の質問を答えても、共有の質問は閉じない。

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

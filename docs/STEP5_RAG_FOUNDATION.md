# STEP5 本番RAG基盤設計

更新日: 2026-09-18

## 目的

STEP4のKV一括FAQを壊さず、本番RAGを次の構成へ移行する。

- Google Drive: 原本
- D1: 資料台帳・本文チャンク・監査・ジョブ
- Vectorize: 意味検索
- KV: キャッシュ・同期状態・RAG世代番号
- Worker Secrets: APIキー等
- GitHub Pages: 一般FAQチャット + 管理者ダッシュボード

## Embedding

初期本番候補:

- provider: Gemini API
- model: gemini-embedding-2
- output dimensions: 384
- metric: cosine
- document format: title: {title} | text: {content}
- query format: task: question answering | query: {content}

理由:

- Vectorize Free stored dimensions: 5,000,000
- 384次元 x 10,000チャンク = 3,840,000 stored dimensions
- 10,000チャンク時点でも約23%の余裕
- 理論最大: floor(5,000,000 / 384) = 13,020チャンク

10,000アクティブチャンクを運用目標とする。

## チャンク

- 目標 800文字
- 最小 250文字
- 最大 1,200文字
- overlap 120文字
- 文字数より見出し・段落・表・ページ・スライド構造を優先

## D1

migration:

`worker/migrations/0001_rag_core.sql`

主要テーブル:

- categories
- documents
- chunks
- audit_logs
- sync_jobs
- chunks_fts (FTS5 virtual table)

### documents

1つの論理資料を `source_id` で識別する。
更新時は既存行を書き換えず、新しい `document_id` と `revision_no` を作る。

`is_current=1` は source_id ごとに1件だけ。

新版完成前:
- new revision = processing / is_current=0
- old revision = active / is_current=1

新版完成後:
- old revision -> inactive / is_current=0
- new revision -> active / is_current=1

### chunks

本文の正本。
Vectorizeに本文を正本として持たせない。

登録中:
- is_active=0

本番化:
- is_active=1

### chunks_fts

FTS5 + trigram。
アプリケーション側で同期する。

自動トリガーを使わない理由:
- staging revisionを誤って検索可能にしない
- 新版のD1/Vectorize/FTS整合性確認後に一括で有効化する

## 検索

1. ユーザー質問を検索用に正規化
2. Vectorize Top 15
3. D1 FTS5 Top 15
4. RRF(k=60)で統合
5. Top 10
6. D1で承認・有効期間・activeを再確認
7. 同一文書・隣接チャンクを重複排除/結合
8. 1資料最大2 Evidence Blocks
9. 標準4、最大6 Evidence Blocks
10. 根拠本文最大 約5,500文字
11. 根拠が弱い場合は生成AIを呼ばない

## 回答状態

- answer
- insufficient
- conflict

根拠資料名・ページ・見出しはAIに自由生成させず、AIが返す evidence_chunk_ids をD1へ照合してUIを構築する。

## 容量監視

Vectorize:
- normal: <60%
- warning: >=60%
- caution: >=80%
- critical: >=90%

D1:
- 警告: 300MB
- 要整理: 400MB
- Free 1DB上限: 500MB

登録前に推定容量、チャンク生成後に実容量を二重確認する。

## 移行手順

STEP5-1:
- D1 schemaをGitHubへ追加
- RAG定数を固定
- 現行Workerには接続しない

STEP5-2:
- Cloudflare D1 database作成
- migration適用
- D1 binding追加
- /health/rag-db で確認

STEP5-3:
- Vectorize 384-dim cosine index作成
- Vectorize binding追加
- Gemini Embedding 2接続
- /health/rag-vector で確認

STEP5-4:
- document/chunk staging API
- capacity guard
- FTS indexing

STEP5-5:
- Hybrid Retrieval (Vectorize + FTS5 + RRF)

STEP5-6:
- Evidence Gate
- 根拠不足時はAIを呼ばない
- 根拠限定AI回答
- AI返却chunk IDをD1へ照合

STEP5-7:
- GitHub Pages管理者ダッシュボード

STEP5-8:
- Google Drive/GAS登録パイプライン
- PDF / Word / Excel / PowerPoint対応

STEP5-9:
- FAQチャットUIを本番RAGへ切替
- STEP4 KV一括検索を退役


## STEP5-2 実装状況

D1 database:
- name: takasago-jhs-komu-ai-rag
- binding: RAG_DB
- migrations_dir: migrations

Worker health:
- GET /health/rag-db

migration適用前の想定:
```json
{
  "ok": true,
  "ragDb": {
    "configured": true,
    "schemaReady": false,
    "missingTables": ["categories","documents","chunks","audit_logs","sync_jobs","chunks_fts"]
  }
}
```

migration適用後の想定:
```json
{
  "ok": true,
  "ragDb": {
    "configured": true,
    "schemaReady": true,
    "missingTables": []
  }
}
```

worker/package.json helper:
- npm run migrate:list
- npm run migrate:remote
- npm run d1:tables

Embedding provider decision:
- Gemini API利用可
- gemini-embedding-2
- 384 dimensions
- cosine


## STEP5-3 Vectorize

Index:
- name: takasago-jhs-komu-rag-v1
- dimensions: 384
- metric: cosine
- binding: RAG_VECTOR

Gemini Embedding 2:
- model: gemini-embedding-2
- output dimensionality: 384
- document format: title: {title} | text: {content}
- query format: task: question answering | query: {content}

Health:
- GET /health/rag-vector

Binding未設定時:
```json
{
  "ok": true,
  "ragVector": {
    "configured": false,
    "vectorBinding": false,
    "geminiEmbedding": true,
    "model": "gemini-embedding-2",
    "dimensions": 384,
    "metric": "cosine",
    "indexName": "takasago-jhs-komu-rag-v1"
  }
}
```

Vectorize binding後:
- vectorBinding=true
- Gemini key設定済みなら configured=true

384 dimensions rationale:
- Gemini Embedding 2 supports flexible 128-3072 dimensions.
- Google recommends 768/1536/3072, but 384 is selected for the project's Free-tier capacity target.
- 10,000 active chunks x 384 = 3,840,000 stored dimensions.
- Retrieval quality must be validated before production cutover.
- If 384 quality is insufficient, create a new 768-dimension v2 index and re-embed; never change an existing index in place.


## STEP5-4 実装

追加:
- worker/rag-chunker.mjs
- worker/rag-store.mjs

管理API:
- POST /admin/rag/schema-ensure
- GET /admin/rag/capacity
- POST /admin/rag/stage
- GET /admin/rag/document-status?documentId=...
- POST /admin/rag/index-next
- POST /admin/rag/finalize
- POST /admin/rag/test-cleanup

すべて FAQ_ADMIN_TOKEN が必要。

### staging

入力された抽出済み本文/sectionsを:
1. 文書構造優先でchunk化
2. SHA-256
3. 容量事前判定
4. documents / chunks / sync_jobs / audit_logsへD1 transactionで登録

staging時:
- documents.status=processing
- documents.is_current=0
- chunks.is_active=0
- FTS未登録

### limits

- extracted text: max 500,000 chars/document
- chunks: max 800/document
- target 800 chars
- max 1,200 chars
- overlap 120 chars
- vector indexing batch: 20 chunks/request

### capacity guard

Vectorize:
- active chunks + new chunks のpeak容量を384 dimensionsで計算
- 5,000,000 stored dimensionsを超える登録を拒否

D1:
- chunks.textのUTF-8 bytesを取得
- FTS/index/metadata overheadを考慮し、本文bytes x4を安全側のworking-set estimateとして表示
- 500MB推定超過時はstagingを拒否
- 実DBファイルサイズとは別の事前推定値であることをUIに明示する

### indexing

/admin/rag/index-next:
- pending chunksを最大20件取得
- Gemini Embedding 2 / 384 dimensions
- Vectorizeへupsert
- accepted chunkをembedding_status=readyへ更新
- sync_jobs progress更新

同じIDへのupsertは再実行可能なので、
Vectorize成功後D1更新が失敗しても再試行可能。

### finalize

全chunkがembedding_status=readyになった後:
1. Vectorize getByIdsでsample反映確認
2. old revisionをinactive
3. new chunksをactive
4. FTS5へnew revisionだけ登録
5. new documentをis_current=1 / active
6. sync job completed
7. old Vectorize vectorsをbest-effort cleanup

old vector cleanup失敗でもD1/FTSの切替は巻き戻さない。
Hybrid RetrievalではD1最終filterを必須にする。

### synthetic verification

GAS helpers:
- ensureRagSchemaStep5
- getRagCapacityStep5
- stageRagSyntheticStep5
- indexRagSyntheticStep5
- statusRagSyntheticStep5
- finalizeRagSyntheticStep5
- cleanupRagSyntheticStep5

sourceId prefix step5-test- のテスト資料だけhard cleanup可能。


## STEP5-5 Hybrid Retrieval

実装:
- worker/rag-retrieval.mjs
- POST /admin/rag/retrieval-test

検索フロー:
1. 質問をGemini Embedding 2 / 384 dimensionsへ変換
2. Vectorize Top15
3. D1 FTS5(trigram) Top15
4. rankのみをRRF(k=60)で統合
5. fused Top10
6. D1 authoritative filter
   - chunks.is_active=1
   - documents.is_current=1
   - documents.status=active
   - approval_status=approved
   - deleted_at IS NULL
   - valid_from / valid_until が現在日付に有効
7. 同一document + 同一headingの隣接chunkを結合
8. documentあたり最大2 evidence blocks
9. 通常4、最大6 evidence blocks
10. evidence合計最大5,500 chars

Vectorize similarity scoreとFTS bm25 raw scoreは直接加算しない。
RRF:
  score = 1/(60 + vectorRank) + 1/(60 + ftsRank)

管理者テストでは以下を表示:
- vectorRank / vectorScore
- ftsRank / ftsScore
- fusedRank / rrfScore
- authoritative
- exclusionReason
- D1由来のsourceId / title / chunkNo

FTS query:
- NFKC normalize
- punctuation除去
- Unicode文字/数字の3文字gramを最大24個作成
- OR query
- FTS障害時もVector retrievalは継続

重要:
- STEP5-5時点ではminimum evidence thresholdは未確定。
- 実資料の質問セットで分布を確認後に閾値を決定する。
- 閾値決定前は先生向けFAQの旧KV検索を置き換えない。

GAS verification:
- testHybridRetrievalStep5
- testHybridRetrievalParaphraseStep5
- runHybridRetrievalSyntheticStep5


## STEP5-6 Evidence Gate / Grounded Answer

目的:
- Vectorizeが何かを1位に返しただけでは根拠採用しない
- 弱い検索結果では生成AIを呼ばない
- AI回答は承認済みD1 evidenceだけに限定する
- 出典カードはAI生成文字列ではなくD1から作る

### synthetic calibration

STEP5合成資料で確認した実測値:

直接質問:
- query: テスト備品Aは何曜日に確認しますか？
- 正解 chunk vector: 0.8282954 / rank 1
- 正解 chunk FTS: rank 1
- distractor vector: 0.7431142 / rank 2
- distractor FTS: rank 2

言い換え:
- query: 備品Aのチェックをする日はいつですか？
- 正解 vector: 0.7997454 / rank 1
- 正解 FTS: rank 1
- distractor vector: 0.70004636 / rank 2
- distractor FTS: none

無関係:
- query: 修学旅行の集合時間は何時ですか？
- top vector: 0.6101101
- second vector: 0.5521759
- FTS: none

### provisional gate

実資料評価前の精度優先暫定値:

Hybrid agreement:
- vectorScore >= 0.75
- vectorRank <= 3
- ftsRank <= 3

Strong vector only:
- vectorRank = 1
- FTSなし
- vectorScore >= 0.82
- 2位との差 >= 0.08

それ以外:
- accepted=false
- AIを呼ばない
- 「登録資料では確認できません。」

注意:
- これは2チャンクのsynthetic testに基づく暫定値
- 実資料のpositive / paraphrase / negative質問セットで再調整必須
- precision優先。迷う場合は回答しない

### Grounded Answer

管理API:
- POST /admin/rag/answer-test

処理:
1. Hybrid Retrieval
2. Evidence Gate
3. usable evidenceなし -> AI未呼び出し
4. usable evidenceあり -> Cerebras / Groq / Gemini fallbackへ根拠限定JSON回答を要求
5. AI status:
   - answer
   - insufficient
   - conflict
6. AI evidenceChunkIdsを、提示済みchunk ID whitelistへ照合
7. 不正ID・根拠IDなし・JSON不正はfail closedでinsufficient
8. source cardsはD1 evidenceから構築

AIには資料名・ページ・chunk IDを自由生成させない。
UIに出す出典情報はD1の実在レコードだけを使用する。

GAS verification:
- testRagAnswerPositiveStep5
- testRagAnswerParaphraseStep5
- testRagAnswerNegativeStep5
- runRagAnswerGateStep5

期待:
- positive -> status=answer / aiCalled=true
- paraphrase -> status=answer / aiCalled=true
- negative -> status=insufficient / aiCalled=false

先生向け現行FAQは、この検証完了まではSTEP4 KV方式のまま維持する。


## STEP5-7 管理者ダッシュボード

GitHub Pages:
- /admin/
- ホームの「設定」を「管理者」へ変更
- ダッシュボード
- 資料管理
- 資料を追加
- Drive同期
- RAG検索テスト
- 利用状況
- システム状態

公開状態で表示してよいもの:
- Worker health
- D1 schema ready
- Vectorize ready
- Evidence Gate ready
- active document/chunk件数
- Vector/D1容量の集計値

公開してはいけないもの:
- FAQ_ADMIN_TOKEN
- API key
- 資料本文
- 管理者メール許可リスト
- 個別資料の管理操作

### Google管理者認証

GitHub Pagesの管理操作はGoogle Identity Servicesを使用する。

Frontend:
- Sign in with Google button
- popup callbackでID tokenを受け取る
- tokenはsessionStorageのみ
- Workerへ Authorization: Bearer <ID token>
- localStorageやGitHubへ保存しない

Worker:
- Google JWKSでRS256署名検証
- iss確認
- aud = GOOGLE_OAUTH_CLIENT_ID
- exp / nbf確認
- email_verified確認
- Google authoritative email（Gmail または Workspace hd）確認
- ADMIN_EMAILS完全一致allowlist
- 不一致は403

既存GAS:
- X-FAQ-Admin-Token / FAQ_ADMIN_TOKENを継続
- GitHub PagesへFAQ_ADMIN_TOKENを渡さない

Worker safe endpoints:
- GET /health/admin-auth
- GET /admin/auth/me
- GET /health/rag-dashboard

Cloudflare設定:
- GOOGLE_OAUTH_CLIENT_ID
- ADMIN_EMAILS

Google Cloud OAuth client:
- Application type: Web application
- Authorized JavaScript origin:
  https://kedamotohironobu-lang.github.io

popup callback方式のため、この実装ではredirect URIは使用しない。


## STEP5-10 FAQチャット

先生向け「校内FAQ」を通常の文章生成画面ではなく、専用チャットUIへ変更する。

### 認証

- 校内FAQのみGoogle職員認証必須
- ADMIN_EMAILSはFAQ利用可
- STAFF_EMAILSで個別職員を許可可能
- STAFF_DOMAINSでGoogle Workspaceドメイン単位の許可が可能
- FAQ以外の9機能は従来どおり

### 会話文脈

検索に利用してよい会話情報:
- 今回の先生の質問
- 必要な場合のみ、直前の先生の質問

検索に利用しない:
- 前回のAI回答
- それ以前のAI回答
- 画面に表示されているAI文章

直前の先生の質問を使う条件:
- 「それ」「その場合」「では」等の明示的な指示語
- 「いつですか？」「誰に出しますか？」等の短い追質問

新しい独立質問では前問を検索文脈へ混ぜない。

### チャット表示

- 先生: 右側
- 校内FAQ: 左側
- 回答ごとにD1由来の根拠資料カード
- contextUsed=trueの場合のみ「直前の先生の質問を補助文脈として検索」と表示
- 会話をクリアすると previousUserQuestion も破棄
- 会話履歴はブラウザ表示用であり、AI回答を検索根拠へ送信しない

### 本番FAQ経路

```text
先生
  ↓ Google職員認証
GitHub Pages FAQ chat
  ↓ current question + 必要時のみ previous USER question
Cloudflare Worker
  ↓
Vectorize Top15 + FTS5 Top15
  ↓
RRF
  ↓
D1 authoritative filter
  ↓
Evidence Gate
  ├─ weak -> AI未呼び出し / 登録資料では確認できません
  └─ strong -> Cerebras -> Groq -> Gemini
                 ↓
           evidenceChunkIds検証
                 ↓
            D1出典カード
```

Worker version: 5.9.0


## STEP5-11 本番運用準備

### 旧KV FAQの正式退役

先生向けFAQは完全に新RAGへ切替済み。

停止:
- 旧KVによる公開FAQ検索
- GET /admin/faq/sources
- POST /admin/faq/source
- POST /admin/faq/remove

互換確認:
- GET /health/faq
  - mode: rag-v2
  - legacyKv: retired
  - publicLegacyRoutes: false

FAQ_KV binding自体は削除せず、将来の小規模cache/status用途への再利用に備えて残す。

### 職員認証

管理者:
- ADMIN_EMAILS

先生向けFAQ:
- ADMIN_EMAILSは自動的に利用可
- STAFF_EMAILSで個別許可
- STAFF_DOMAINSで管理されたGoogle Workspaceドメイン単位の許可

STAFF_DOMAINSではID tokenの hd とメールドメインが一致することもWorker側で確認する。

### Production Readiness

GET /health/production-readiness

判定:
- D1 schema ready
- Vectorize ready
- Evidence Gate enabled
- AI provider >= 1
- Google admin auth ready
- staff FAQ pilot auth ready
- approved active documents >= 1
- active ready chunks >= 1
- legacy KV public routes retired

pilotReady:
- ADMIN_EMAILSの管理者による試験運用が可能

schoolwideReady:
- pilotReady
- STAFF_EMAILS または STAFF_DOMAINS が設定済み

管理者ダッシュボード「システム状態」に本番運用準備チェックを表示する。

Worker version: 5.10.0


## STEP5-12 Drive同期・版管理

目的:
- Drive原本の更新を検出
- 変更のない資料を再Embeddingしない
- 新版の準備が完了してから旧版をinactiveへ切替
- Drive原本が見つからない場合は即削除せずsource_missingへ
- 管理操作をaudit_logsで追跡

### Drive sync scan

GAS:
- scanDriveSyncStep5()
- getDriveSyncDefaultsStep5(fileId)
- markDriveSourceMissingStep5(sourceId)
- listRagAuditStep5(limit)

状態:
- new: D1に現行版なし
- changed: Drive更新日時がD1 source_modified_atより新しい
- unchanged: Drive更新なし
- missing: D1現行版はあるが指定Driveフォルダ直下で原本を確認できない

変更ありの場合:
1. 管理者が同期候補を選択
2. 本文・構造を再プレビュー
3. カテゴリ・管理担当・有効期間を確認
4. 承認チェック
5. D1 staging
6. Embedding / Vectorize
7. Vectorize query反映確認
8. FTS5作成
9. 新版current/active
10. 旧版inactive / FTS削除 / chunks inactive
11. 旧Vectorをbest-effort cleanup

### No-op sync

2段階で無駄な再処理を防止:
1. Drive modifiedAtがD1現行版と同じ + メタデータ同一
   - GAS側で即skip
2. modifiedAtが変わっていても抽出本文SHA-256 + 主要メタデータが同一
   - Worker側で新revisionを作らずskip
   - source_modified_at / last_synced_atのみ更新
   - audit action: source_unchanged

### Revision jobs

sync_jobs.job_type:
- 初回: register
- 現行版あり: update

documents.last_synced_at:
- finalize成功時にCURRENT_TIMESTAMP
- 内容変更なし確認時もCURRENT_TIMESTAMP

### source_missing

Driveフォルダから原本が見つからなくても自動削除しない。
管理者確認後:
- documents.status = source_missing
- chunks.is_active = 0
- FTS削除
- Vectorize IDsをbest-effort削除
- D1のrevision履歴は保持
- audit action: source_missing

同じsourceIdの原本が再登録された場合:
- 新revisionを通常どおり作成
- 完成後にcurrent/activeへ切替

### Audit

Worker:
- GET /admin/rag/audit?limit=100
- GET /admin/rag/source-status?sourceId=...
- POST /admin/rag/source-missing

管理者ダッシュボード:
- システム状態に監査ログ表示
- Drive同期画面にD1側の現行Drive資料・source_modified_at・last_synced_atを表示

監査ログへ通常の先生の質問本文は保存しない。

Worker version: 5.11.0


## STEP5-13 自動メンテナンス

目的:
- 有効期限切れ資料をFAQ検索対象から自動除外
- Drive変更を日次検出
- 自動登録・自動削除は行わず管理者承認を維持
- 停滞ジョブを検出
- 日本時間で有効期間を判定

### 有効期間

検索時のD1 authoritative filter:
- valid_from > 今日(JST) -> document_not_yet_valid
- valid_until < 今日(JST) -> document_expired

SQLiteでは:
- date('now','+9 hours')

有効期限日は当日いっぱい有効として扱い、翌日から期限切れ。

### Worker maintenance

POST /admin/rag/maintenance

認証:
- Google管理者Bearer token
- またはGASのFAQ_ADMIN_TOKEN

処理:
1. current / active / approved の資料から期限切れを抽出
2. chunks.is_active=0
3. chunks_fts削除
4. documents.status='expired'
5. Vectorize IDをbest-effort削除
6. audit_logsへ document_expired
7. 24時間以上停滞しているsync_jobs件数を返す

D1/FTSを正本として扱うため、Vectorize削除に一時失敗しても検索時authoritative filterで除外される。

### GAS日次監視

関数:
- runDailyRagMaintenanceStep5()
- getDailyMaintenanceStatusStep5()
- installDailyMaintenanceTriggerStep5()
- uninstallDailyMaintenanceTriggerStep5()

有効化は管理者が明示的に行う。
有効化後:
- 毎日6時台
- timezone Asia/Tokyo

実行内容:
1. Worker maintenance
2. scanDriveSyncStep5()
3. changed/new/missing/unchanged件数をScript Propertiesへ保存

保存しないもの:
- 資料本文
- チャンク本文
- 先生の質問
- AI回答

Driveの変更資料:
- 自動登録しない
- 管理者がGAS画面でプレビュー・承認後に登録

Drive原本未確認:
- 自動でsource_missingにしない
- 管理者確認後のみ検索対象から外す

### 管理者画面

「システム状態」に:
- 期限・状態を今すぐ点検
- 実行結果
- 監査ログ

GAS画面「⑥ 自動メンテナンス」に:
- 日次監視 有効/無効
- 前回実行結果
- 今すぐ実行
- 日次監視を有効化
- 日次監視を無効化

### OAuth scope

Apps Scriptトリガー管理のため追加:
- https://www.googleapis.com/auth/script.scriptapp

既存デプロイ更新時にGoogleの追加承認が求められる場合がある。

Worker version: 5.12.0


## STEP5-14 運用・復旧

本番運用前の最終仕上げ。

### 資料削除

物理削除は禁止。

対象:
- current
- active
- deleted_at IS NULL

処理:
- FTS削除
- chunks.is_active=0
- documents.status='inactive'
- documents.deleted_at=CURRENT_TIMESTAMP
- Vectorize IDs best-effort削除
- sync_jobsへ delete/completed
- audit: document_soft_deleted

Drive原本・D1本文・版履歴・監査ログは保持する。

### 資料復旧

対象:
- current
- deleted_at IS NOT NULL
- approval_status='approved'
- 有効期限内

処理:
- deleted_at解除
- documents.status='processing'
- chunks.embedding_status='pending'
- vector_id=NULL
- reindex job作成
- index-next
- Vectorize
- finalize
- active復帰

期限切れ資料は直接復旧せず、Driveから有効期間を確認して新版登録する。

### ジョブ失敗管理

Embedding / Vectorizeエラー時:
- 対象chunk: embedding_status='error'
- document: status='error', vector_status='error'
- sync_job: status='failed'
- error_code='EMBEDDING_OR_VECTORIZE_FAILED'

再試行可能:
- failed
- queued/running/waiting_reviewが24時間以上停滞

再試行:
- error/indexing chunkをpendingへ
- retry_count + 1
- errorをクリア
- document processing
- index-next / finalize
- audit: sync_job_retried

### バックアップマニフェスト

GET /admin/rag/backup-manifest

管理者Google認証必須。

含む:
- categories
- documents metadata
- chunk metadata/hash
- audit logs
- sync jobs

含まない:
- chunk本文
- API key
- FAQ_ADMIN_TOKEN
- Google ID token
- FAQ会話履歴

Driveを本文の正本とする。
D1/Vectorize障害時はDriveから再構築する。

### 管理者UI

資料管理:
- active現行資料: 「検索から外す」
- 論理削除済み現行資料: 「復旧」
- 旧revision: 履歴保持

システム状態:
- 同期ジョブ一覧
- failed/stalled再試行
- バックアップマニフェスト
- 監査ログ

### 運用マニュアル

docs/ADMIN_OPERATION_MANUAL.md

Worker version: 5.13.0

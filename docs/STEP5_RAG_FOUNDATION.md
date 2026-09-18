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
- document task: RETRIEVAL_DOCUMENT
- query task: RETRIEVAL_QUERY

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
- GitHub Pages管理者ダッシュボード

STEP5-7:
- Google Drive/GAS登録パイプライン
- PDF / Word / Excel / PowerPoint対応

STEP5-8:
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

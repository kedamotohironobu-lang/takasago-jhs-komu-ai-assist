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

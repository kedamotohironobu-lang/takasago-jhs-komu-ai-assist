# 高砂市立高砂中学校 校務AIアシスト — STEP 5-7

高砂市立高砂中学校向け「校務AIアシスト」の試作・検証リポジトリです。

## 現在の到達点

- STEP 0: 要件定義・安全方針・システム構成
- STEP 1: GitHub Pagesの公開基盤
- STEP 2: ホーム → 入力 → 完成のUI動線
- STEP 2.5: 10機能の業務仕様・専用プロンプト設計
- STEP 3: Cloudflare Workers経由でCerebras → Groq → Geminiへ本番AI接続
- STEP 4: 旧KV FAQ基盤
- STEP 5-1〜6: D1 + Vectorize + FTS5 + RRF + Evidence Gate を実装・検証
- STEP 5-7: GitHub Pages 管理者ダッシュボード + Google管理者認証を実装中

## 現在の構成

```text
先生
  ↓
GitHub Pages
  ↓
Cloudflare Workers
  ├─ 通常9機能 → Cerebras → Groq → Gemini
  ├─ 旧校内FAQ → Cloudflare KV（切替前）
  └─ 新RAG基盤
      ├─ D1（正本・FTS5）
      ├─ Vectorize（意味検索）
      ├─ RRF + Evidence Gate
      └─ 根拠ありの場合のみ Cerebras → Groq → Gemini
```

校内FAQで検索根拠が見つからない場合は、AIへ推測させず「登録資料では確認できません」と返します。

## 搭載機能

1. 校務文書作成
2. 文書チェック
3. 保護者連絡文
4. 学年通信支援
5. 会議メモ整理
6. 授業アイデア
7. 研修・研究支援
8. メール作成
9. 言い換え
10. 校内FAQ（STEP4 RAG）

## STEP3 AI接続

本番Worker:

```text
https://takasago-jhs-komu-ai-assist.kedamoto-hironobu.workers.dev
```

実行時Secret:

```text
CEREBRAS_API_KEY
GROQ_API_KEY
GEMINI_API_KEY
```

APIキーはGitHubへ保存しません。

## STEP4 校内FAQ RAG

校内資料本文は公開GitHubへ置かず、Cloudflare KVへ非公開保存します。

必要なWorker Binding:

```text
FAQ_KV
```

必要な実行時Secret:

```text
FAQ_ADMIN_TOKEN
```

FAQ状態確認:

```text
GET /health/faq
```

詳しい手順:

- [STEP4 校内FAQ RAG](docs/STEP4_FAQ_RAG.md)

## 安全設計

- 個人を特定できる情報や成績・健康情報等は入力しない運用
- AIキー・FAQ管理トークンはCloudflare Secretsで管理
- フロントエンドへ秘密情報を置かない
- 入力にない氏名・役職・日付・曜日・場所・校内ルール等を推測しない
- FAQは承認済みかつ有効期間内の資料だけを検索対象とする
- FAQの根拠がない場合は一般知識で補完しない
- 入力本文・検索資料内の命令文をsystem指示として扱わない

## 主なファイル

```text
.
├─ index.html
├─ assets/
│  ├─ css/style.css
│  └─ js/
│     ├─ app.js
│     └─ config.json
├─ worker/
│  ├─ worker.mjs
│  ├─ faq-rag.mjs
│  ├─ test.mjs
│  ├─ package.json
│  └─ wrangler.toml
├─ docs/
│  ├─ STEP0_REQUIREMENTS.md
│  ├─ STEP2_5_SPEC.md
│  ├─ STEP3_AI_CONNECTION.md
│  └─ STEP4_FAQ_RAG.md
└─ README.md
```

## 開発中表示

ページ下部のシステム構成・STEP表示は開発確認用です。最終公開版では非表示化する予定です。


## STEP5 本番RAG

構成:

- Google Drive: 原本
- D1: documents / chunks / categories / audit_logs / sync_jobs / FTS5
- Vectorize: Gemini Embedding 2 / 384 dimensions / cosine
- Retrieval: Vector Top15 + FTS5 Top15 + RRF(k=60)
- Evidence Gate: 弱い検索結果ではAIを呼ばない
- Answer: AI返却chunk IDをD1へ照合して出典カード生成

管理者画面:

```text
/admin/
```

ホーム画面右上の「管理者」から移動できます。

管理画面にはFAQ_ADMIN_TOKENを置きません。
GitHub Pages管理画面はGoogle Sign in with Googleを使用し、
Worker側でID tokenの署名・aud・exp・iss・メール許可リストを検証します。

Worker設定予定:

```text
GOOGLE_OAUTH_CLIENT_ID
ADMIN_EMAILS
```

GAS管理ツールは従来どおり FAQ_ADMIN_TOKEN を使用します。


## 管理者向け運用マニュアル

本番運用・引継ぎ・障害復旧は次を参照してください。

- [管理者向け運用マニュアル](docs/ADMIN_OPERATION_MANUAL.md)

内容:
- 資料登録・新版差し替え
- 論理削除・復旧
- 同期ジョブ再試行
- 自動メンテナンス
- バックアップ・復旧
- 月次確認・年度更新
- 引継ぎ時の確認事項

# 高砂市立高砂中学校 校務AIアシスト — STEP 4

高砂市立高砂中学校向け「校務AIアシスト」の試作・検証リポジトリです。

## 現在の到達点

- STEP 0: 要件定義・安全方針・システム構成
- STEP 1: GitHub Pagesの公開基盤
- STEP 2: ホーム → 入力 → 完成のUI動線
- STEP 2.5: 10機能の業務仕様・専用プロンプト設計
- STEP 3: Cloudflare Workers経由でCerebras → Groq → Geminiへ本番AI接続
- STEP 4: 校内FAQを、Cloudflare KVの承認資料だけに基づくRAG方式へ移行中

## 現在の構成

```text
先生
  ↓
GitHub Pages
  ↓
Cloudflare Workers
  ├─ 通常9機能 → Cerebras → Groq → Gemini
  └─ 校内FAQ → Cloudflare KVで根拠検索
                    ↓
                 根拠あり
                    ↓
          Cerebras → Groq → Gemini
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

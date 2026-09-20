# 高砂市立高砂中学校 校務AIアシスト — STEP 6-5

高砂市立高砂中学校向け「校務AIアシスト」の試作・検証リポジトリです。

## 現在の到達点

- STEP 0〜3: 要件定義、GitHub Pages UI、Cloudflare Workers AI接続
- STEP 4: 旧KV FAQ基盤（現在は退役）
- STEP 5: D1 + Vectorize + FTS5 + RRF + Evidence Gate、本番RAG、Google管理者/職員認証、Drive同期、版管理、復旧、監査
- STEP 6-1: 本番公開前の最終受入テスト
- STEP 6-2: 質問本文を保存しない利用状況・定型品質フィードバック
- STEP 6-3: 24時間運用監視・障害早期検知・匿名利用ログ180日保持

## 現在の構成

```text
先生
  ↓
GitHub Pages
  ├─ 通常9機能
  └─ 校内FAQ（Google職員認証）
        ↓
Cloudflare Worker
  ├─ 通常9機能 → Cerebras → Groq → Gemini
  └─ 校内FAQ
       ↓
    Vectorize + FTS5
       ↓
    RRF + Evidence Gate
       ↓
    D1 authoritative filter
       ↓
    根拠ありの場合だけAI
       ↓
    D1由来の出典カード

Google Drive
  ↓ 原本
GAS管理ツール
  ↓
D1 / Vectorize / FTS5
```

校内FAQで検索根拠が弱い場合はAIを呼ばず、
「登録資料では確認できません。」と返します。

利用分析では質問本文・AI回答本文・メールアドレス・IP・Tokenを保存しません。

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

## 旧STEP4 KV FAQ

旧Cloudflare KV FAQは正式退役済みです。

現在の先生向け校内FAQは、
D1 + Vectorize + FTS5 + RRF + Evidence Gateを使用します。

`FAQ_KV` bindingは小規模cache/status用途への再利用余地を残していますが、
先生向けFAQ本文の検索正本には使用しません。

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


## 本番公開前の最終受入

- [STEP6-1 最終受入テスト](docs/STEP6_FINAL_ACCEPTANCE.md)

管理者ダッシュボードの「✅ 最終受入テスト」から、自動受入・本番データ条件・実運用確認を一括管理します。


## 利用品質・運用監視

- [STEP6-2 / STEP6-3 利用品質・運用監視](docs/STEP6_QUALITY_OPERATIONS.md)

質問本文を保存しない匿名利用集計、定型フィードバック、24時間運用監視、180日保持を実装しています。


## FAQ改善提案

- [STEP6-4 / STEP6-5 FAQ改善候補・改善提案](docs/STEP6_IMPROVEMENT_DASHBOARD.md)

質問本文を保存せず、定型評価・資料状態・期限・利用回数・FAQ全体の根拠不足率から改善候補を自動抽出します。

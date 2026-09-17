# 高砂市立高砂中学校 校務AIアシスト — STEP 0〜1

このリポジトリは、高砂市立高砂中学校向け「校務AIアシスト」の初期構成です。

## 現在の到達点

- STEP 0: 要件定義・安全方針・システム構成を確定
- STEP 1: GitHub Pagesで公開できる静的サイトの土台を作成
- AI接続: まだ未実装（STEP 4以降で Cloudflare Workers 経由で接続）

## 最終構成（予定）

```text
先生
  ↓
GitHub Pages
  ↓
Cloudflare Workers
  ↓
Cerebras（主AI）
  ↓ 障害・上限時
Groq（予備1）
  ↓ 障害・上限時
Gemini（予備2）
```

## ファイル構成

```text
.
├─ index.html
├─ 404.html
├─ assets/
│  ├─ css/
│  │  └─ style.css
│  └─ js/
│     ├─ app.js
│     └─ config.example.js
├─ docs/
│  ├─ STEP0_REQUIREMENTS.md
│  └─ STEP1_GITHUB_PAGES.md
├─ .gitignore
└─ README.md
```

## GitHub Pagesでの公開

1. このフォルダの中身をGitHubリポジトリへアップロードします。
2. GitHubの **Settings → Pages** を開きます。
3. **Deploy from a branch** を選びます。
4. Branchを `main`、Folderを `/(root)` にします。
5. Save後、発行されたURLを開きます。

詳しくは `docs/STEP1_GITHUB_PAGES.md` を参照してください。

## 重要

- `CEREBRAS_API_KEY`、`GROQ_API_KEY`、`GEMINI_API_KEY` はGitHubに保存しません。
- APIキーはCloudflare WorkersのSecretsに保存します。
- STEP 0〜1ではAI通信を行いません。
- 初期運用では、氏名・住所・電話番号・成績・健康情報など、個人を特定できる情報を入力しない方針です。

## 公式サイト

高砂市立高砂中学校  
https://www.takasago.ed.jp/taka-t/

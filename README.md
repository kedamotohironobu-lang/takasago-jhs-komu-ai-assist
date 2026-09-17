# 高砂市立高砂中学校 校務AIアシスト — STEP 2

このリポジトリは、高砂市立高砂中学校向け「校務AIアシスト」の試作版です。

## 現在の到達点

- STEP 0: 要件定義・安全方針・システム構成を確定
- STEP 1: GitHub Pagesで公開できる静的サイトの土台を作成
- STEP 2: ホーム画面 → 入力画面 → 完成画面の基本動線を実装
- AI接続: まだ未実装（次工程で Cloudflare Workers 経由で接続）

## STEP 2 の主な変更

- ホーム上部の見出しを **「校務AIアシスト」** に統一
- 学校をイメージしたオリジナル背景を追加
- サンプルUI1を基に、カラフルで文字の大きいホーム画面へ変更
- 10機能すべてをクリック可能に変更
- 各機能から入力画面へ移動できるように実装
- 「AIで作成する」で完成画面へ進む基本動線を実装
- コピー、編集に戻る、簡単調整ボタンを追加
- 現在の完成文はAI未接続のため動作確認用の仮出力

## UIの基本動線

```text
ホーム画面
  ↓ 機能をクリック
入力画面
  ↓ 「AIで作成する」
完成画面
  ↓
コピー / 調整 / 編集に戻る
```

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
│  ├─ STEP1_GITHUB_PAGES.md
│  └─ STEP2_UI_FLOW.md
├─ .gitignore
└─ README.md
```

## GitHub Pages

GitHub Pagesでは `main` / `/(root)` を公開対象にします。

## 重要

- `CEREBRAS_API_KEY`、`GROQ_API_KEY`、`GEMINI_API_KEY` はGitHubに保存しません。
- APIキーはCloudflare WorkersのSecretsに保存します。
- STEP 2ではAI通信を行いません。
- STEP 2の完成文章は画面動作確認用の仮出力です。
- 下部の「最終システム構成」は開発中のみ表示し、最終版では削除します。

## 公式サイト

高砂市立高砂中学校  
https://www.takasago.ed.jp/taka-t/

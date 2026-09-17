# STEP 1 — GitHub Pages 初期構築

## このSTEPの目的

AIをまだ接続せず、GitHub Pagesで「高砂市立高砂中学校 校務AIアシスト」の土台が表示できる状態まで作ります。

## 1. 推奨リポジトリ名

```text
takasago-jhs-komu-ai-assist
```

英数字とハイフンだけで構成し、今後Cloudflare Workers側でも識別しやすくします。

## 2. GitHubへアップロードするもの

このZIPを展開し、フォルダの**中身**をリポジトリ直下へ配置します。

```text
index.html
404.html
assets/
docs/
README.md
.gitignore
```

## 3. GitHub Pagesを有効にする

1. GitHubで新しいリポジトリを作成。
2. `takasago-jhs-komu-ai-assist` と入力。
3. Publicまたは組織の運用方針に合う公開設定を選ぶ。
4. このセットのファイルをアップロード。
5. **Settings** を開く。
6. 左メニューの **Pages** を開く。
7. **Source** で `Deploy from a branch` を選択。
8. Branchを `main` にする。
9. Folderを `/(root)` にする。
10. **Save**。

数分後にGitHub Pages URLが発行されます。

## 4. STEP 1の確認項目

公開URLをPCとスマホで開き、次を確認します。

- 学校名が正しく表示される。
- 「校務AIアシスト」が大きく表示される。
- 10機能のプレビューカードが見える。
- スマホではカードが2列になる。
- 個人情報に関する注意が見える。
- 「STEP 1 基盤構築済み」が表示される。
- AI生成ボタンはまだ実行されない。

## 5. APIキーはまだ設定しない

STEP 1では、次のキーは不要です。

```text
CEREBRAS_API_KEY
GROQ_API_KEY
GEMINI_API_KEY
```

これらは後工程でCloudflare WorkersのSecretsへ設定します。

GitHub PagesにAPIキーを書かないでください。

## 6. STEP 2への引き継ぎ

STEP 2では、現在のプレビューカードを正式なUI1に仕上げます。

- 各タイルをクリック可能にする。
- サンプルUI1に近い見やすいレイアウトへ仕上げる。
- クリックした機能に応じてUI2へ移動する。
- まだAI APIは接続しない。

STEP 2終了時点で、画面遷移だけは完成形にします。

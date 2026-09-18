# FAQ資料登録ツール（Google Drive連携）

高砂市立高砂中学校「校務AIアシスト」の校内FAQ用管理ツールです。

Google Driveの指定フォルダから資料を選び、本文を抽出してCloudflare Workerの管理APIへ送信し、Cloudflare KVのRAG資料として登録します。

## V1対応形式

- Googleドキュメント
- Googleスプレッドシート
- Googleスライド
- TXT
- CSV
- JSON
- HTML
- Markdown

V1ではPDF、Word、Excel、PowerPointの直接読み取りは未対応です。いったんGoogle形式へ変換して登録します。

## 仕組み

```text
管理者
  ↓
Google Apps Script 管理画面
  ↓
指定Google Driveフォルダ
  ↓
本文を抽出
  ↓
Cloudflare Worker 管理API
  ↓
Cloudflare KV
  ↓
校内FAQ RAG
```

`FAQ_ADMIN_TOKEN` はブラウザのJavaScriptへ渡しません。GASのScript Propertiesからサーバー側で読み込みます。

## Apps Scriptプロジェクトの作成

1. Google Apps Scriptで新しいプロジェクトを作成
2. `Code.gs` をこのフォルダの `Code.gs` 全文で置換
3. HTMLファイル `Index` を作り、`Index.html` 全文を貼り付け
4. プロジェクト設定でマニフェスト表示を有効化
5. `appsscript.json` をこのフォルダの内容で置換
6. タイムゾーンを `Asia/Tokyo` にする

## Script Properties

Apps Scriptの「プロジェクトの設定」→「スクリプト プロパティ」に次を設定します。

### 必須

```text
FAQ_ADMIN_TOKEN
```

Cloudflare Workerに登録した `FAQ_ADMIN_TOKEN` と同じ値。

### 推奨

```text
FAQ_FOLDER_ID
```

FAQ資料を置くGoogle DriveフォルダのID。管理画面から後で設定することもできます。

### 任意

```text
WORKER_BASE_URL
```

未設定時は次を使用します。

```text
https://takasago-jhs-komu-ai-assist.kedamoto-hironobu.workers.dev
```

## Webアプリとしてデプロイ

管理者用ツールなので、公開範囲を広げないでください。

推奨:

- 実行するユーザー: 自分
- アクセスできるユーザー: 自分のみ、または組織内の必要な管理者だけ

「全員」や「匿名ユーザー」を選ばないでください。

## 管理画面でできること

- Driveフォルダの指定
- フォルダ直下の資料一覧表示
- 資料本文のプレビュー
- 承認確認
- 管理担当・版・有効期間の入力
- RAGへの登録・更新
- RAG登録済み資料の一覧表示
- RAG資料の削除
- Cloudflare KV接続状態の表示

同じGoogle Driveファイルを再登録すると、同じ `sourceId` で更新されます。

## sourceId

Google DriveファイルIDから自動生成します。

```text
gdrive-＜Google Drive file ID＞
```

## 安全上の注意

- 生徒・保護者・教職員の個人情報を含む資料は登録しない
- 成績、健康情報、家庭状況等の機微情報を含む資料は登録しない
- FAQの根拠として承認された資料だけを登録する
- 有効期限が切れた資料は自動的に検索対象外になる
- 実際の校内資料を登録する前に、校務AIアシスト本体へ認証・アクセス制御を追加する
- `FAQ_ADMIN_TOKEN` をGitHubやHTMLへ書かない

## 次段階

- PDF / Word / Excel / PowerPointの直接取り込み
- Google Driveフォルダの自動同期
- 更新されたファイルだけ再登録
- 登録履歴・監査ログ
- Cloudflare Access等による校務AI本体のアクセス制御

# FAQ資料登録ツール（STEP5-8 / Google Drive → 本番RAG）

高砂市立高砂中学校「校務AIアシスト」の校内FAQ用管理ツールです。

Google Driveの指定フォルダから承認済み資料を選び、本文・見出し・シート・スライド構造を抽出して、Cloudflare Worker経由で D1 / Vectorize / FTS5 へ登録します。

## 現在の登録フロー

```text
管理者
  ↓
Google Apps Script 管理画面
  ↓
指定Google Driveフォルダ
  ↓
本文・構造をプレビュー
  ↓
カテゴリ・担当・版・有効期間・対象シート/スライドを確認
  ↓
D1へstaging
  ↓
Gemini Embedding 2 / 384次元
  ↓
Vectorize
  ↓
FTS5
  ↓
Vectorize query反映確認
  ↓
current / activeへ切替
```

新版登録時は旧版を即時に壊さず、新版のVectorize/FTS5整合確認後に切り替えます。

## STEP5-8前半の直接対応形式

- Googleドキュメント
- Googleスプレッドシート
- Googleスライド
- TXT
- CSV
- JSON
- HTML
- Markdown

Googleスプレッドシートはシート単位、Googleスライドはスライド単位で登録対象を選択できます。

## STEP5-8後半対応

- Word (.doc/.docx): 一時Googleドキュメントへ変換して抽出
- Excel (.xls/.xlsx): 一時Googleスプレッドシートへ変換し、シート単位で抽出
- PowerPoint (.ppt/.pptx): 一時Googleスライドへ変換し、スライド単位で抽出
- PDF: 管理者が「PDF変換/OCRを許可」を確認した場合だけ、Google DriveのPDF→Googleドキュメント変換/OCRを実行

一時変換ファイルは抽出後に削除し、原本は変更しません。

Apps Scriptでは拡張Driveサービス（Drive API v3）を有効化し、`drive.file` scopeを使用します。

## Apps Script側の主な関数

```text
getRagAdminStateStep5()
getRagCategoriesStep5()
getDriveFiles()
previewDriveFileStep5(fileId)
registerDriveFileStep5(options)
continueRagRegistrationStep5(documentId)
continueLastRagRegistrationStep5()
listRagDocumentsStep5()
getRagDocumentStatusStep5(documentId)
```

登録処理が1回のGAS実行時間で完了しない場合は `needsContinue=true` を返します。
管理画面の「処理を続ける」を押すと同じ documentId から再開します。

## Script Properties

必須:

```text
FAQ_ADMIN_TOKEN
```

Cloudflare Workerに登録した `FAQ_ADMIN_TOKEN` と同じ値です。
ブラウザJavaScriptへは渡しません。

推奨:

```text
FAQ_FOLDER_ID
```

FAQ資料を置くGoogle DriveフォルダIDです。管理画面から設定できます。

任意:

```text
WORKER_BASE_URL
```

未設定時:

```text
https://takasago-jhs-komu-ai-assist.kedamoto-hironobu.workers.dev
```

## Webアプリの公開範囲

管理者用なので、アクセス範囲を広げないでください。

推奨:
- 実行するユーザー: 自分
- アクセスできるユーザー: 自分のみ、または組織内の必要な管理者だけ
- 匿名アクセス: 使用しない

## 最初の確認

実際の校内規則を入れる前に、短い架空Googleドキュメントで確認します。

例:

```text
見出し1: STEP5-8登録テスト

これは登録確認用の架空資料です。
テスト備品Cの確認日は水曜日です。
実際の校内規則ではありません。
```

確認事項:
1. Drive一覧に表示される
2. プレビューできる
3. D1 staging成功
4. Embedding / Vectorize成功
5. activeになる
6. GitHub Pages管理者画面「資料管理」に表示される
7. RAG検索テストで「テスト備品Cの確認日は？」に正しい根拠が出る
8. 無関係質問ではEvidence Gateが遮断する

## 安全設計

- 承認済み資料だけ登録
- D1を正本とする
- Vectorizeの本文を正本にしない
- 旧版は新版完成までcurrentのまま
- Evidence Gateで弱い検索結果を遮断
- FAQ_ADMIN_TOKENをGitHub/HTMLへ置かない
- 個人情報・成績・健康情報等を含む資料は登録しない
- 有効期間外・未承認・旧版は検索根拠にしない


## Drive同期・新版差し替え

STEP5-12では、Drive資料一覧が同期状態を表示します。

- 変更あり
- 新規
- 最新
- 原本未確認

「最新」は再Embeddingしません。

「変更あり」は:
1. 確認して登録
2. 本文・構造プレビュー
3. メタデータ確認
4. 承認チェック
5. 新RAGへ登録

同じsourceIdで登録するため、自動的に次revisionになります。
新版がD1 / Vectorize / FTS5まで完成した後で旧版がinactiveになります。

Drive更新日時が変わっていても本文SHA-256と主要メタデータが現行版と同じ場合は、新revisionを作らず同期日時だけ更新します。

Driveフォルダから見つからない資料は自動削除しません。
管理者が「検索対象から外す」を押した場合のみsource_missingとなり、FAQ検索から除外されます。D1履歴は保持します。

監査ログ:
- document_staged
- document_activated
- source_unchanged
- source_missing
- test cleanup

旧KV用の /admin/faq/source 等は正式退役しており、現行GASでは使用しません。

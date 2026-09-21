# 高砂市立高砂中学校 校務AIアシスト
## 管理者向け運用マニュアル

更新基準: STEP5-14  
対象: 校務AIアシスト / 校内FAQ RAG 管理者  
目的: 担当者が変わっても、安全に資料登録・更新・削除・復旧・障害対応を行えること

---

## 1. システム全体像

校内FAQは次の構成です。

```text
Google Drive
  ↓ 原本
Google Apps Script 管理ツール
  ↓ 本文抽出・確認・承認
Cloudflare Worker
  ↓
D1
  - 資料メタデータ
  - 本文チャンク
  - 版管理
  - 監査ログ
  - 同期ジョブ
  ↓
Gemini Embedding
  ↓
Vectorize
  ↓
FTS5
  ↓
Hybrid Retrieval + Evidence Gate
  ↓
AI回答
```

重要:
- Google Driveを資料原本の正本とする。
- D1をRAG本文・状態管理の正本とする。
- Vectorizeは検索用ベクトルであり正本ではない。
- 旧KV FAQは退役済み。
- 根拠が弱い場合、AIは回答せず「登録資料では確認できません。」とする。

---

## 2. 管理者が使う画面

### GitHub Pages 管理者ダッシュボード

```text
https://kedamotohironobu-lang.github.io/takasago-jhs-komu-ai-assist/admin/
```

主な機能:
- ダッシュボード
- 資料管理
- 資料追加
- Drive同期状態
- RAG検索テスト
- 利用状況
- システム状態
- 監査ログ
- 同期ジョブ再試行
- バックアップマニフェスト

### GAS FAQ資料登録ツール

Google Drive原本の
- 新規検出
- 更新検出
- プレビュー
- シート / スライド選択
- PDF OCR確認
- 新版登録
- 日次監視

に使用する。

---

## 3. Cloudflareで必要な設定名

値そのものはこの文書へ記録しない。

### Secrets / Variables

```text
CEREBRAS_API_KEY
GROQ_API_KEY
GEMINI_API_KEY
FAQ_ADMIN_TOKEN
GOOGLE_OAUTH_CLIENT_ID
ADMIN_EMAILS
STAFF_EMAILS
STAFF_DOMAINS
```

用途:
- ADMIN_EMAILS: 管理者ダッシュボード利用者
- STAFF_EMAILS: FAQを利用できる個別職員
- STAFF_DOMAINS: 管理されたGoogle Workspace単位の職員許可

ADMIN_EMAILSの管理者は職員FAQも利用できる。

---

## 4. GAS Script Properties

値そのものはこの文書へ記録しない。

```text
FAQ_ADMIN_TOKEN
FAQ_FOLDER_ID
WORKER_BASE_URL（任意）
```

過去にVectorize Index作成用として使用した
`CLOUDFLARE_VECTORIZE_TOKEN`
は、Index作成後に不要であればScript Propertiesから削除し、
Cloudflare側でもトークンを失効させる。

---

## 5. 通常の資料登録

1. FAQ用Google Driveフォルダへ原本を置く。
2. GAS管理画面を開く。
3. 「Drive資料・同期状況」を更新する。
4. 「新規」の資料で「確認して登録」を押す。
5. 本文・構造をプレビューする。
6. カテゴリ、管理担当、版、有効期間を確認する。
7. Excel / Sheetsは必要なシートを選ぶ。
8. PowerPoint / Slidesは必要なスライドを選ぶ。
9. PDFは管理者がOCR利用を確認した場合だけ許可する。
10. 「承認済み資料であること」を確認する。
11. 「新RAGへ登録する」を押す。
12. 登録完了を確認する。
13. 管理者画面「RAG検索テスト」で実際に検索する。
14. 根拠資料が正しいことを確認する。

登録してはいけない例:
- 生徒名簿
- 成績
- 健康情報
- 家庭情報
- 個別支援情報
- 人事上の機微情報

---

## 6. 資料更新・新版差し替え

Drive原本を更新後、GASで同期状況を確認する。

### 状態

- 新規: D1に現行版なし
- 変更あり: Drive原本がD1より新しい
- 最新: 再処理不要
- 原本未確認: D1にはあるが指定Driveフォルダで原本を確認できない

### 変更ありの場合

1. 「確認して登録」を押す。
2. 新版本文をプレビューする。
3. カテゴリ・担当・有効期間を確認する。
4. 承認する。
5. 新RAGへ登録する。

切替順:
```text
新版 staging
→ Embedding
→ Vectorize
→ FTS5
→ 検索可能確認
→ 新版 active/current
→ 旧版 inactive
```

新版完成前に旧版を止めない。

本文SHA-256と主要メタデータが同じ場合、
新版revisionは作らず再Embeddingを省略する。

---

## 7. 資料削除

「資料管理」から active の現行資料だけ削除可能。

操作:
1. 「検索から外す」を押す。
2. 確認画面で `削除` と入力する。
3. 完了を確認する。

この削除は論理削除。

削除されないもの:
- Google Drive原本
- D1のdocuments行
- D1のchunks本文
- 監査ログ
- 版履歴

検索から外れるもの:
- FTS5
- active chunk
- Vectorize検索対象

削除操作は監査ログに
`document_soft_deleted`
として残る。

---

## 8. 資料復旧

論理削除済み現行資料は「復旧」ボタンから戻せる。

復旧処理:
```text
deleted_at解除
→ chunksをpending
→ 再Embedding
→ Vectorize
→ FTS5
→ active
```

有効期限切れ資料はそのまま復旧しない。
Drive原本を確認し、有効期間を更新した新版として登録する。

復旧操作は監査ログに
`document_restore_started`
として残る。

---

## 9. Drive原本未確認

Driveフォルダから資料が見つからなくても自動削除しない。

管理者が移動・削除を確認した場合だけ
「検索対象から外す」を実行する。

処理後:
- status = source_missing
- chunks inactive
- FTS削除
- Vectorize削除を試行
- D1履歴は保持

原本が戻った場合はDriveから新版登録する。

---

## 10. 有効期限

日付は日本時間で判定する。

例:
```text
valid_until = 2026-09-30
```

9月30日中は有効。  
10月1日から期限切れ。

日次メンテナンスにより:
- documents.status = expired
- chunks inactive
- FTS削除
- Vectorize削除を試行

監査ログ:
`document_expired`

---

## 11. 自動メンテナンス

GAS管理画面「自動メンテナンス」から有効化する。

実行:
- 毎日6時台 JST

自動で行う:
- 期限切れ資料除外
- Drive変更件数検出
- 新規資料件数検出
- 原本未確認件数検出
- 24時間以上の停滞ジョブ件数確認

自動で行わない:
- Drive新版登録
- PDF OCR承認
- 原本未確認資料の削除
- source_missing化

---

## 12. 同期ジョブ障害

管理者画面「システム状態」→「同期ジョブ・再試行」を確認する。

再試行可能:
- status = failed
- queued / running / waiting_review が24時間以上停滞

「再試行」を押すと:
1. error / indexing chunkをpendingへ戻す。
2. retry_countを+1。
3. Embedding / Vectorizeを再実行。
4. finalizeまで実行。
5. 監査ログへ記録。

監査ログ:
`sync_job_retried`

completedジョブは再試行しない。

---

## 13. よくある異常

### Embedding / Vectorizeエラー

表示例:
```text
EMBEDDING_OR_VECTORIZE_FAILED
```

対応:
1. Cloudflare Workerのシステム状態を確認。
2. Gemini API設定を確認。
3. Vectorize接続を確認。
4. 「同期ジョブ・再試行」から再試行。

### Vectorize反映待ち

数秒後に再試行する。
保存済みでも近傍検索Indexへの反映に時間差がある場合がある。

### RAGで回答できない

確認:
1. 資料が active / approved / current か。
2. 有効期間内か。
3. RAG検索テストで候補が出るか。
4. Evidence Gateで除外されていないか。
5. 根拠資料に質問内容が実際に書かれているか。

Evidence Gateを安易に緩めない。

---

## 14. バックアップ

管理者画面
「システム状態」→「バックアップマニフェスト」
からJSONを保存する。

ファイルには含める:
- categories
- documentsメタデータ
- sourceId / revision
- Drive file ID
- content hash
- chunkメタデータ / chunk hash
- audit logs
- sync jobs

含めない:
- chunk本文
- APIキー
- FAQ_ADMIN_TOKEN
- Google ID token
- AI会話履歴

推奨:
- 本番公開前
- 大規模資料追加前
- 年度更新前
- システム構成変更前

に保存する。

---

## 15. 障害時の復旧

### A. Vectorizeだけ壊れた場合

D1本文が残っていれば再Embeddingで復旧可能。

1. 対象資料を確認。
2. 必要に応じて論理削除→復旧、または再登録。
3. Vectorizeを再生成。
4. RAG検索テスト。
5. 根拠カード確認。

### B. D1状態がおかしい場合

1. Google Drive原本を変更しない。
2. バックアップマニフェストを確保。
3. D1スキーマを再作成。
4. カテゴリを復元。
5. Drive原本から順番に再登録。
6. マニフェストとsourceId / version / hashを照合。
7. RAG検索テスト。
8. 一般職員公開を再開。

### C. Drive原本を失った場合

D1本文を通常バックアップマニフェストへ含めていないため、
Driveのごみ箱・組織側バックアップ・原本保管から先に復元する。

Driveを資料本文の正本として扱うため、
D1を唯一の原本にしない。

将来 `source_type = upload` の資料登録を本番利用する場合は、
バックアップマニフェストに本文を含めない設計のため、
アップロード元の原本ファイルを別途安全に保管する。

---

## 16. 本番公開前チェック

管理者画面
「システム状態」→「本番運用準備チェック」

確認:
- D1 OK
- Vectorize OK
- Evidence Gate OK
- AI Provider OK
- 管理者認証 OK
- 一般職員認証設定 OK
- 承認済み実資料あり
- active chunkあり
- 旧KV公開経路 retired

`schoolwideReady=true`
を一般公開の目安とする。

---

## 17. 月1回の確認

- 管理者アカウントを確認
- STAFF_EMAILS / STAFF_DOMAINSを確認
- 期限切れ資料を確認
- source_missing資料を確認
- failed / stalled jobを確認
- Vectorize容量を確認
- D1容量を確認
- 監査ログを確認
- バックアップマニフェストを保存
- FAQで代表質問を3～5問確認

---

## 18. 年度更新

1. 旧年度資料を即削除しない。
2. 新年度資料をDriveへ配置。
3. 新版を登録。
4. RAG検索テスト。
5. 新版回答を確認。
6. 必要に応じて旧資料のvalid_untilを管理。
7. 期限切れ後に自動除外を確認。
8. バックアップマニフェストを保存。

---

## 19. 引継ぎ時に渡すもの

- この運用マニュアル
- GitHub repository URL
- GitHub Pages URL
- Worker URL
- GASプロジェクト名
- FAQ用Driveフォルダの場所
- Cloudflareの管理権限
- Google OAuth設定の管理権限
- ADMIN_EMAILS / STAFF設定の運用ルール
- 最新バックアップマニフェスト

渡してはいけない方法:
- APIキーを文書へ直書き
- FAQ_ADMIN_TOKENをメール本文へ記載
- OAuth Client Secretをスクリーンショットで共有

---

## 20. 基本方針

迷った場合は、
**自動化より確認を優先する。**

特に:
- 資料削除
- 原本未確認
- PDF OCR
- 新版切替
- 職員公開範囲

は管理者が内容を確認してから実行する。

校内FAQは「もっともらしい回答」ではなく、
**承認済み資料に根拠がある回答だけを返すこと**
を最優先とする。


---

## 21. STEP6-1 最終受入テスト

本番公開前は管理者ダッシュボードの

```text
✅ 最終受入テスト
```

を実施する。

判定区分:
1. 自動受入テスト
2. 本番データ条件
3. 人が確認する実運用テスト

3区分すべてPASSになるまで
「本番公開条件を満たしています」とは扱わない。

詳細:
- [STEP6-1 最終受入テスト](STEP6_FINAL_ACCEPTANCE.md)

合格時:
- 受入レポートJSONを保存
- 「合格結果を監査ログへ記録」を実行
- acceptance_run_recorded を監査ログで確認

大規模なRAG変更、認証方式変更、年度更新などの後は再度STEP6-1を実行する。


---

## 22. 利用状況・品質改善

管理者ダッシュボードの

```text
📈 利用状況
```

で、質問本文を保存しない匿名集計を確認する。

確認:
- 30日利用件数
- 回答率
- 根拠不足率
- 役に立った率
- provider別利用
- よく使われる根拠資料
- 改善理由
- 24時間運用監視

保存しない:
- 質問本文
- AI回答本文
- メールアドレス
- IP
- Token

利用イベント・定型フィードバックの保持期間は180日。

詳細:
- [STEP6-2 / STEP6-3 利用品質・運用監視](STEP6_QUALITY_OPERATIONS.md)

根拠不足率が高くてもEvidence Gateを受入目的だけで緩めない。
まず承認資料の不足・新版・有効期間・チャンク構造を確認する。


---

## 23. FAQ改善提案

管理者ダッシュボードの

```text
🛠 改善提案
```

を週1回程度確認する。

自動抽出する候補:
- error / source_missing / expired
- 改善評価が付いた資料
- 30日以内に期限を迎える資料
- 30日以上参照されていない資料
- FAQ全体の根拠不足率が高い状態

改善候補は自動修正しない。

特にEvidence Gateを改善候補解消のためだけに緩めない。
必要資料・版・Drive原本・見出し・チャンク構造を確認する。

詳細:
- [STEP6-4 / STEP6-5 FAQ改善候補・改善提案](STEP6_IMPROVEMENT_DASHBOARD.md)


---

## 24. 月次レポート・改善サイクル

毎月1回、管理者ダッシュボードの

```text
📄 月次レポート
```

から前月分を作成する。

保存:
- JSON
- 必要に応じて印刷 / PDF

改善提案で確認が必要な候補は

```text
対応中にする
```

を押して改善サイクルへ登録する。

状態:
- 未対応
- 対応中
- 完了
- 見送り

自由記述メモは保存しない。

改善状態変更は監査ログへ記録され、
バックアップマニフェストにも改善サイクル状態を含める。

詳細:
- [STEP6-6 / STEP6-7 月次運用レポート・改善サイクル](STEP6_MONTHLY_CYCLE.md)


---

## 25. 月次自動保存・自動通知

既存の日次トリガー（毎朝6時台 JST）で、
次を自動実行する。

- RAGメンテナンス
- Drive変更確認
- 前月レポートのGoogle Drive保存
- 24時間運用監視
- FAQ改善候補判定
- 状態変化時のメール通知
- 自動運用結果のD1記録

月次レポートはFAQ原本直下ではなく、

```text
校務AIアシスト_月次レポート
```

サブフォルダへ保存する。

通知先を複数指定する場合:

```text
OPS_NOTIFY_EMAILS
```

をScript Propertiesへカンマ区切りで設定する。

未設定時はトリガー実行者のGoogleアカウントを使用する。

質問本文・AI回答本文はメール通知しない。

詳細:
- [STEP6-8 / STEP6-9 月次自動保存・自動通知](STEP6_AUTOMATION.md)

---

## 22. STEP8-5 FAQ品質テスト（50問）

管理者ダッシュボードの「FAQ品質テスト」から、STEP8-4で定義した50問を順番にRAGへ送信できる。

自動判定で確認する項目:
- 回答対象の質問で status=answer になっていること
- 想定した資料が根拠資料カードに含まれること
- 根拠なし質問で status=insufficient、aiCalled=false になること

自動PASS候補は回答本文の意味的正確性まで保証しない。回答ありの項目は管理者が本文を確認する。

FAIL時はEvidence Gateの閾値を緩めず、先に次を確認する。
- 対象資料が approved / active / current か
- 見出しと本文に必要事項が明記されているか
- 新旧版・重複資料がないか
- チャンク化とVectorizeが完了しているか
- 想定資料名と登録資料名が大きくずれていないか

結果はCSVまたはJSONで保存できる。資料更新後や年度更新時は同じ50問を再実行し、前回結果と比較する。

---

## 23. STEP8-8 FAIL原因分析

FAQ品質テストのFAILは、管理画面で次の原因へ自動分類する。

- 検索未到達: 想定資料が上位候補に出ていない。
- Evidence Gate: 想定資料は候補にあるがGateで不採用。
- AI・資料内容: 根拠は採用されたが、AIが回答できない／資料記述が質問へ直接答えていない。
- 根拠資料違い: 回答はできたが想定資料ではない。
- 根拠なし誤回答: 本来拒否すべき質問に回答した。最優先確認。
- API・認証/通信: 品質判定対象外。認証・Worker・通信を直して再実行する。

改善時はEvidence Gateを先に緩めない。原因分類に従って、資料本文・見出し・版・current/active/approved・検索対象・重複資料を先に確認する。

CSV/JSONにも原因分類と推奨対応を保存する。

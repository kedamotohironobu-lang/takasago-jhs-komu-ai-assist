# STEP6-6 / STEP6-7 月次運用レポート・改善サイクル

高砂市立高砂中学校 校務AIアシスト  
対象: 校内FAQ 本番運用

---

## 1. STEP6-6 月次運用レポート

管理者画面:

```text
📄 月次レポート
```

対象月を選択し、

```text
レポート作成
```

を押す。

### 集計単位

Asia/Tokyo の暦月。

例:

```text
2026-09
→ 2026年9月1日 00:00 ～ 9月30日 23:59:59 JST
```

### 表示項目

- 利用件数
- 回答率
- 根拠不足率
- 役に立った率
- AI呼出回数
- エラー
- 平均応答時間
- 同期ジョブ成功 / 失敗
- 改善サイクル現在数
- 当月完了・見送り
- よく使われた根拠資料
- AI provider別利用
- 機能別利用
- 作成時点の有効実資料
- 作成時点の有効チャンク
- 作成時点の改善候補件数

### 保存

```text
JSON保存
印刷 / PDF
```

JSON例:

```text
takasago-jhs-monthly-report-2026-09.json
```

### プライバシー

レポートに含めない:

- 質問本文
- AI回答本文
- メールアドレス
- IP
- Token
- API key

---

## 2. STEP6-7 改善サイクル

管理者画面:

```text
🛠 改善提案
```

改善候補カードから:

```text
対応中にする
```

を押す。

改善サイクルの状態:

- 未対応
- 対応中
- 完了
- 見送り

自由記述メモは保存しない。

### 状態の考え方

#### 未対応

候補として登録したが、まだ確認を開始していない。

#### 対応中

Drive原本・新版・カテゴリ・RAG検索結果などを確認中。

#### 完了

必要な修正・確認を終えた。

#### 見送り

確認した結果、現時点では修正不要と判断した。

見送りは削除ではない。
改善候補自体が再び条件に該当すれば、今後も画面へ出る場合がある。

---

## 3. 保存する情報

improvement_actions:

- candidateId
- candidateType
- documentId
- sourceId
- title
- level
- status
- createdAt
- updatedAt
- startedAt
- completedAt
- 操作管理用actor

保存しない:

- 質問本文
- AI回答本文
- 自由記述メモ

---

## 4. 監査

改善状態変更は audit_logs に

```text
improvement_action_updated
```

として記録する。

---

## 5. バックアップ

バックアップマニフェストに改善サイクル状態を含める。

含める:

- candidateId
- title
- level
- status
- timestamps

改善担当者メールは改善サイクルのバックアップ項目には含めない。

---

## 6. 月次運用例

月初:

1. 前月の月次レポートを作成。
2. JSON保存。
3. 必要に応じてPDF保存。
4. 改善提案を確認。
5. 要対応候補を「対応中」にする。

月中:

1. Drive原本確認。
2. 新版登録。
3. RAG検索テスト。
4. FAQ回答確認。
5. 必要に応じて改善状態を更新。

月末:

1. 対応済み項目を「完了」。
2. 修正不要項目を「見送り」。
3. failed / stalled jobを確認。
4. バックアップマニフェストを保存。

---

## 7. 改善判断の原則

改善候補を解消するためだけに:

- Evidence Gateを緩めない
- AIのプロンプトを根拠なく変更しない
- 資料削除を自動化しない
- valid_untilを自動延長しない
- 承認状態を自動変更しない

管理者が資料原本と運用実態を確認して判断する。

---

## 8. Worker API

管理者Google認証必須:

```text
GET  /admin/monthly-report?month=YYYY-MM
GET  /admin/improvement/actions
POST /admin/improvement/action
```

---

## 9. Worker code version

```text
6.7.0
```

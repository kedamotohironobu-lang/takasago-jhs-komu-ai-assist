# STEP6-8 / STEP6-9 月次自動保存・異常／改善候補の自動通知

高砂市立高砂中学校 校務AIアシスト  
対象: 本番運用自動化

---

## 1. STEP6-8 月次レポートの自動保存

既存のGAS日次トリガー:

```text
runDailyRagMaintenanceStep5
毎日6時台 JST
```

に月次保存処理を追加する。

追加トリガーは作成しない。

### 保存対象

前月の月次運用レポート。

例:

```text
2026年10月の日次処理
→ 2026-09 を保存
```

### 保存先

FAQ原本フォルダ直下には保存しない。

初回実行時にFAQ原本フォルダ内へ:

```text
校務AIアシスト_月次レポート
```

サブフォルダを作成する。

ファイル名:

```text
校務AIアシスト_月次レポート_YYYY-MM.json
```

同じ月のファイルがすでに存在する場合は重複作成しない。

### 保存内容

STEP6-6の月次レポートJSON。

含まない:

- 質問本文
- AI回答本文
- 利用者メール
- IP
- Token
- API key

---

## 2. STEP6-9 自動通知

毎日の自動処理で確認する:

- 24時間の運用監視
- failed job
- stalled job
- error rate
- latency
- FAQ改善候補
- 要対応件数
- 要確認件数
- 資料状態異常
- 30日以内の期限

### 通知するタイミング

毎日同じ内容を通知しない。

状態fingerprintを保存し、

- 初めて要確認を検出
- 要確認内容が変化
- 要確認状態が解消

した場合のみ通知する。

fingerprintは、単純な件数だけではなく、

- 運用警告コード
- failed / stalled job件数
- 要対応・要確認となった改善候補ID
- 改善候補の重要度

を使って判定する。

そのため、件数が同じでも別の改善候補へ入れ替わった場合は状態変化として検知する。
質問本文・AI回答本文はfingerprintに使用しない。

### 通知内容

通知メールには質問本文・AI回答本文を含めない。

通知するのは:

- 運用状態
- アラート件数
- 改善候補の要対応件数
- 改善候補の要確認件数
- 資料状態問題件数
- 期限30日以内件数
- 管理者画面URL

---

## 3. 通知先

優先:

```text
Script Properties
OPS_NOTIFY_EMAILS
```

複数の場合はカンマ区切り。

例:

```text
admin1@example.jp,admin2@example.jp
```

未設定の場合:

```text
Session.getEffectiveUser().getEmail()
```

を使用する。

どちらも取得できず要確認状態が発生した場合、
日次自動運用は「一部要確認」として記録する。

---

## 4. Google権限

GAS manifestへ追加:

```text
https://www.googleapis.com/auth/script.send_mail
```

Gmail本文の読み取り権限は追加しない。

manifest更新後はGoogleによる再承認が必要。

---

## 5. 自動運用状態

GAS側:

```text
⑦ 月次レポート・自動通知
```

で確認できる。

表示:

- 自動運用 有効 / 無効
- 通知先件数
- 最終月次保存月
- 前回自動実行状態
- 保存先
- 通知結果

GitHub Pages管理者画面:

```text
🩺 システム状態
→ 自動運用
```

でWorkerに記録された最終実行結果を確認できる。

---

## 6. 自動運用結果のD1記録

Worker:

```text
automation_runs
```

に保存する。

保存:

- runType
- status
- reportMonth
- reportSaved
- notificationStatus
- operationsHealth
- improvementActionCount
- improvementWatchCount
- errorCount
- createdAt

保持期間:

```text
365日
```

質問本文・回答本文は保存しない。

---

## 7. 手動テスト

GAS管理画面:

```text
前月レポートを今すぐ保存
通知テスト
状態を再確認
```

を使用する。

通知テストは実際にメールを送信するため、
管理者確認後に実行する。

---

## 8. Worker API

管理者認証必須:

```text
GET  /admin/automation/status
POST /admin/automation/run-record
```

GASは既存の `FAQ_ADMIN_TOKEN` を
`X-FAQ-Admin-Token` で使用する。

---

## 9. 安全設計

自動化しない:

- Drive新版の自動承認
- 原本未確認資料の自動削除
- Evidence Gate変更
- valid_until自動延長
- 改善候補の自動修正
- 職員権限変更

自動化する:

- 点検
- 月次レポート保存
- 状態変化通知
- 実行履歴記録

---

## 10. Worker code version

```text
6.9.0
```

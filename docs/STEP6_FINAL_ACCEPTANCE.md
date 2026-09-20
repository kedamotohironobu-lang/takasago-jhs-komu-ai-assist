# STEP6-1 最終受入テスト

高砂市立高砂中学校 校務AIアシスト  
校内FAQ RAG 本番公開前の最終確認

---

## 1. 目的

STEP5までで構築した基盤を、本番公開前に一括確認する。

受入判定は次の3区分をすべて確認する。

1. 自動受入テスト
2. 本番データ条件
3. 人が確認する実運用テスト

自動テストだけで本番公開可とはしない。

---

## 2. 自動受入テスト

管理者ダッシュボード:

```text
✅ 最終受入テスト
→ 自動受入テストを実行
```

架空資料のみを使用する。

受入用sourceId:

```text
step5-test-step6-acceptance-v1
```

テスト内容:

- Worker v6.1系が稼働
- D1 schema ready
- Vectorize接続
- Gemini Embedding設定
- Evidence Gate有効
- Google管理者認証
- 管理者アカウントによる職員FAQ認証
- AI Providerが1つ以上
- 旧KV公開経路退役
- failed / stalled jobがない
- バックアップマニフェストに本文・秘密値を含めない
- 架空資料staging
- Embedding / Vectorize / FTS5 / finalize
- Hybrid Retrievalで正しい架空資料を採用
- AI回答が「木曜日」を返す
- D1由来の根拠資料カード
- 未登録質問はEvidence Gateで停止
- 未登録質問ではAI未呼び出し
- 論理削除後は検索対象外
- 復旧後は再び検索可能
- テスト資料を最後にcleanup

途中でエラーが発生しても、最後にcleanupを試行する。

---

## 3. 本番データ条件

以下が必要。

- STAFF_EMAILS または STAFF_DOMAINS設定済み
- テスト資料を除く承認済み実資料あり
- 実資料のactive/ready chunkあり
- 旧KV公開経路 retired
- failed / 24時間以上停滞 jobがない
- production-readiness.schoolwideReady = true

この区分は実資料・一般職員設定がない状態ではPASSにならない。

---

## 4. 人が確認する実運用テスト

管理者が実際に確認してチェックする。

### 4-1 一般職員ログイン

ADMIN_EMAILSに含まれない一般職員アカウントでFAQへログインできる。

### 4-2 実資料の正常回答

実資料に明記された内容を質問する。

確認:
- 回答が原文内容と一致
- 資料名が正しい
- 見出し / シート / スライド等が正しい
- AIが資料にない事実を追加していない

### 4-3 追質問

例:

```text
先生: 出張後の復命書はいつまでに提出しますか？
FAQ: ...
先生: それは誰に出しますか？
```

確認:
- 直前の先生の質問だけを補助文脈として使用
- 前回AI回答は検索根拠にしない

### 4-4 根拠なし質問

実資料にない学校固有質問を行う。

期待:

```text
登録資料では確認できません。
```

推測回答しないこと。

### 4-5 Drive新版差し替え

同じDrive原本を変更する。

確認:

```text
旧版 -> inactive
新版 -> current / active
```

FAQ回答も新版内容に切り替わる。

### 4-6 自動メンテナンス

GAS:

```text
日次監視 有効
毎日6時台 JST
```

「今すぐ実行」も正常終了する。

### 4-7 バックアップ

管理者画面からバックアップマニフェストを保存する。

確認:

```json
"containsChunkText": false,
"containsSecrets": false
```

---

## 5. 最終判定

次をすべて満たす場合のみ、管理画面で

```text
本番公開条件を満たしています
```

と表示する。

- 自動受入テスト PASS
- 本番データ条件 PASS
- 手動確認 7 / 7

この状態で「合格結果を監査ログへ記録」を押す。

監査ログ:

```text
acceptance_run_recorded
STEP6-1
passed
```

---

## 6. 受入レポート

「受入レポート保存」からJSONを取得する。

例:

```text
takasago-jhs-step6-1-acceptance-YYYY-MM-DDTHH-MM-SS.json
```

含む:
- 自動チェック結果
- production readiness結果
- 手動確認状態
- overallPassed

含まない:
- API key
- FAQ_ADMIN_TOKEN
- Google ID token
- 資料本文
- FAQ会話本文

---

## 7. FAIL時

FAIL項目を修正し、再度「自動受入テストを実行」する。

自動テスト用資料は毎回cleanupされる。

本番資料の内容を変更してテストを通すのではなく、
原因を特定して修正する。

Evidence Gateの閾値を受入テスト合格のためだけに緩めない。

---

## 8. 本番公開後

公開後も次を継続する。

- 月次代表質問テスト
- failed / stalled job確認
- source_missing確認
- 有効期限確認
- 容量確認
- バックアップマニフェスト
- STAFF_EMAILS / STAFF_DOMAINS確認
- 年度更新前後の再受入確認

大きな構成変更後はSTEP6-1を再実行する。

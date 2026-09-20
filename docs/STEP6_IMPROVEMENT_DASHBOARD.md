# STEP6-4 / STEP6-5 FAQ改善候補・改善提案

高砂市立高砂中学校 校務AIアシスト  
対象: 校内FAQ 本番運用後の品質改善

---

## 1. 目的

質問本文を保存しないまま、管理者がFAQ改善の優先箇所を確認できるようにする。

改善提案はAIの自由判断ではなく、D1に保存された匿名利用集計・定型評価・資料状態を決め打ちルールで判定する。

---

## 2. STEP6-4 改善候補の自動抽出

対象期間:
- 標準30日
- APIでは7〜180日

抽出対象:

### A. 資料状態

現行資料が次の場合:
- error
- source_missing
- expired

### B. 品質フィードバック

資料が根拠として使われた回答に対して
「改善が必要」が付いた場合。

定型理由:
- wrong_source
- answer_incomplete
- hard_to_understand
- outdated
- other

要対応候補:
- 根拠違いが1件以上
- 古い情報が1件以上
- 改善評価が2件以上

その他の改善評価:
- 要確認

### C. 有効期限

valid_untilがJST基準で30日以内。

### D. 未利用資料

- current
- active
- approved
- 有効期間内
- テスト資料ではない
- 登録から対象期間以上経過
- 対象期間中に回答根拠として1度も参照されていない

未利用＝不要とは断定しない。
検索しやすさ・対象範囲・必要性の確認候補として扱う。

### E. FAQ全体の根拠不足

FAQリクエストが10件以上ある場合:

- 根拠不足率40%以上: 改善候補
- 根拠不足率60%以上: 要対応候補

Evidence Gateを緩める判断には使わない。
まず承認資料・版・見出し・チャンク構造を確認する。

---

## 3. プライバシー

改善候補抽出で使用しない情報:

- 質問本文
- AI回答本文
- 職員メールアドレス
- IPアドレス
- Google ID token
- API key
- FAQ_ADMIN_TOKEN

利用する情報:

- usage event
- documentId
- 定型フィードバック
- document status
- valid_until
- created_at
- sourceId
- category

---

## 4. STEP6-5 管理者改善提案ダッシュボード

左メニュー:

```text
🛠 改善提案
```

表示:

- 要対応件数
- 要確認件数
- 未利用資料件数
- FAQ根拠不足率

改善候補カード:

- 要対応
- 要確認
- 参考

カードから関連画面へ移動できる。

例:
- 資料状態 → 資料管理
- 根拠違い → RAG検索テスト
- 期限 → Drive同期
- FAQ全体の資料不足 → 資料追加
- 未利用資料 → 資料管理

---

## 5. 改善レポート

管理画面:

```text
改善レポート保存
```

出力例:

```text
takasago-jhs-faq-improvement-YYYY-MM-DDTHH-MM-SS.json
```

含む:
- 集計期間
- summary
- recommendations

含まない:
- 質問本文
- 回答本文
- 利用者メール

---

## 6. 管理者の判断

改善候補は自動修正しない。

特に次は自動変更禁止:
- Evidence Gate閾値
- 資料本文
- valid_until
- revision
- approval
- source_missing
- 資料削除

管理者がDrive原本と運用ルールを確認してから変更する。

---

## 7. 推奨確認頻度

週1回:
- 要対応
- 根拠違い
- 情報が古い
- error / source_missing

月1回:
- 未利用資料
- 根拠不足率
- 期限30日以内
- 改善レポート保存

---

## 8. Worker API

管理者Google認証必須:

```text
GET /admin/improvement/candidates?days=30
```

---

## 9. バージョン

STEP6-4 / STEP6-5実装時のWorker code version:

```text
6.5.0
```

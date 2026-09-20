# STEP6-2 / STEP6-3 利用品質・運用監視

高砂市立高砂中学校 校務AIアシスト  
対象: 校内FAQ / 校務AIアシスト 本番運用

---

## 1. STEP6-2 利用状況・品質フィードバック

### 目的

本番公開後に、
- FAQが実際に使われているか
- 根拠不足が多くないか
- どの資料がよく参照されているか
- 回答が役に立っているか

を確認する。

### 保存しないもの

- 先生の質問本文
- AI回答本文
- Googleメールアドレス
- IPアドレス
- Google ID token
- API key
- FAQ_ADMIN_TOKEN

### 保存するもの

- requestId
- toolId
- answer / insufficient / error
- AIを呼んだか
- provider / model
- latency
- evidence count
- contextUsed
- 根拠documentId
- 定型フィードバック

### FAQフィードバック

回答下部:

```text
👍 役に立った
△ 改善が必要
```

「改善が必要」の理由:

- 根拠が違う
- 回答が足りない
- わかりにくい
- 情報が古い
- その他

自由記述は保存しない。

### 管理者画面

「📈 利用状況・品質改善」で30日集計を表示:

- 利用件数
- 回答率
- 根拠不足率
- 役に立った率
- AI呼出回数
- エラー数
- 平均応答時間
- 評価件数
- よく使われる根拠資料
- provider別利用
- 機能別利用
- 改善理由

---

## 2. STEP6-3 運用監視・障害早期検知

管理者画面の利用状況に「24時間 運用監視」を表示。

監視対象:

- requests
- error rate
- insufficient rate
- average latency
- max latency
- failed sync jobs
- stalled sync jobs

### 警告条件

次はシステム障害候補:

- failed job > 0
- 24時間以上stalled job > 0
- 10件以上の利用がある状態でerror rate >= 10%

次は品質改善候補:

- 10件以上の利用がある状態で平均応答 >= 8秒
- 10件以上の利用がある状態でinsufficient rate >= 60%

根拠不足率の高さは必ずしも障害ではない。
登録資料が不足している可能性を確認する。

---

## 3. D1テーブル

### usage_events

質問本文を持たない利用イベント。

### usage_sources

利用イベントと根拠documentIdの対応。

### feedback_events

requestId単位の定型フィードバック。

---

## 4. 保持期間

匿名利用イベント・定型フィードバックは180日。

日次メンテナンスで180日超を削除する。

資料本文・監査ログの保持ルールとは分離する。

---

## 5. 管理者の確認頻度

週1回:
- error rate
- failed / stalled jobs
- insufficient rate
- 改善理由

月1回:
- よく使われる根拠資料
- 根拠不足傾向
- provider利用
- 応答時間
- RAG容量

---

## 6. 品質改善の考え方

「根拠不足が多い」場合:
- Evidence Gateを安易に緩めない
- 必要な承認資料がDriveにあるか確認
- チャンクや見出し構造を確認
- 資料の有効期間・版を確認

「根拠が違う」が増えた場合:
- 類似資料の重複
- 旧版の残存
- 資料カテゴリ
- chunk境界

を確認する。

「情報が古い」が増えた場合:
- Drive同期
- source_modified_at
- valid_until
- current revision

を確認する。

---

## 7. Worker API

管理者認証必須:

```text
GET /admin/usage/summary?days=30
GET /admin/operations/summary?hours=24
```

職員認証必須:

```text
POST /api/feedback
```

---

## 8. バージョン

STEP6-2 / STEP6-3実装時のWorker code version:

```text
6.3.0
```

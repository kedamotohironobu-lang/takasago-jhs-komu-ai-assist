# STEP 3 — Cloudflare Workers 経由のAI接続

## 到達点

- GitHub Pages からAPIキーを完全に分離
- Cloudflare Worker の `POST /api/generate` へ送信
- Cerebras → Groq → Gemini の順で自動フォールバック
- 入力上限、タイムアウト、二重送信防止、エラー表示を実装
- 校内FAQは根拠資料未接続のため回答を禁止（後工程でRAG化）
- Worker URL未設定時は、現在の公開UIを壊さない接続待ち表示

## 1. Cloudflare側で設定するSecret

```text
CEREBRAS_API_KEY
GROQ_API_KEY
GEMINI_API_KEY
```

少なくとも1つ設定すれば動作します。推奨は3つすべてです。キー本体はGitHubへ保存しません。

## 2. デプロイ

```bash
cd worker
npm install
npx wrangler login
npx wrangler secret put CEREBRAS_API_KEY
npx wrangler secret put GROQ_API_KEY
npx wrangler secret put GEMINI_API_KEY
npx wrangler deploy
```

デプロイ後に表示される `https://...workers.dev` を控えます。

## 3. ヘルスチェック

```bash
curl https://＜Worker URL＞/health
```

`{"ok":true,...}` が返ればWorker側は正常です。

## 4. GitHub Pages側へURL設定

`assets/js/config.json` の `workerBaseUrl` に、末尾 `/` なしでWorker URLを設定します。

```json
{
  "workerBaseUrl": "https://xxxx.workers.dev",
  "allowDemoFallback": false,
  "requestTimeoutMs": 65000
}
```

## 5. 動作確認

1. 保護者連絡文を選択
2. 個人情報を含まないテスト文を入力
3. 「AIで作成する」
4. 完成文章を確認
5. 「もう少し短く」等の再調整を確認
6. 校内FAQは「根拠資料接続後に有効化」と表示されることを確認

## 6. モデル初期値（2026-09-18時点）

- Cerebras: `gpt-oss-120b`
- Groq: `openai/gpt-oss-20b`
- Gemini: `gemini-3.6-flash`

モデル名は `wrangler.toml` の変数で変更できます。

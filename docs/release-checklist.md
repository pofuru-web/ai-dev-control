# v0.1 リリースチェックリスト

凡例: `[x]` = Phase 1D で Claude Code が実行して確認（コマンドと結果を記載）／ `[ ]` = 未実施（家主または今後の作業）。**すべてが `[x]` になるまで「リリース可」とは判断しません。**

確認対象: ブランチ `feature/phase1f-final-polish`（ベース `0824ec9`＋Phase 1F の変更）。Phase 1F の実行結果に更新済み（Phase 1E 時点は 219/48、Phase 1D 時点は 166/29）。

## A. 自動検証（Phase 1F で実行）
- [x] `npm run typecheck` — 成功（exit 0）
- [x] `npm run lint` — 成功（exit 0）
- [x] `npm test` — Vitest 12 ファイル / **240 件成功・0 件失敗**（基準 219 + 追加 21）
- [x] `npm run build` — 成功（JS 291.42 kB）
- [x] `npm run test:e2e` — Playwright **51 件成功・0 件失敗**（基準 48 + 追加 3。GitHub 通信はモック）
- [x] 既存テストの削除・無効化・条件緩和なし — 既存のテストファイルは Phase 1E で変更なし（追加は新規ファイル2つのみ。`git diff --numstat 04711ac -- tests` に既存ファイルの変更なし）
- [x] 追加テストが修正を検出すること — M-1/M-2/M-3/M-5 の各修正を一時的に無効化すると該当テストが失敗することを確認（その後元に戻し 219/219）
- [x] ビルド成果物の秘密情報検査 — `dist` に `ghp_` / `github_pat_` / `gho_` / `GITHUB_TOKEN` / `Authorization` / `Bearer` なし。`api.github.com` の文字列もなし（ブラウザは GitHub を直接呼ばない）
- [x] 履歴全体の秘密情報検査 — トークン・秘密鍵のパターン 0 件。追跡されている `.env*` は `.env.example`（トークン空欄）のみ
- [x] `npm audit` — moderate 7 件（すべて開発用依存。`--omit=dev` は 0 件）。強制更新なし・依存変更なし
- [x] GitHub への書き込み経路がないこと — 上流呼び出しは `fetchSnapshot.ts` の GET 1 箇所のみ（`grep` で確認）、Function は GET 以外を 405（テストと追加確認で HEAD/OPTIONS/POST も 405）

## B. 実環境（Netlify）の確認
- [x]（家主報告）Phase 1A: 実 API 同期（Issue 1 / PR 1 / Commit 3、rateLimit 60/56）
- [x]（家主報告）Phase 1B: 受入 8 項目合格（コミット 81129ec）
- [x]（家主報告）Phase 1C: 受入 7 項目合格（コミット f596c5a）。同時刻の保存の排他は対象外
- [x]（家主報告）Phase 1E: 受入 8 項目合格（コミット 0824ec9。旧バックアップの保存、デプロイ成功・Node 22、既存データ維持、GitHub 同期、プロジェクト移動禁止、リポジトリ変更の確認、削除確認、不正バックアップの拒否）。**任意の破損データ試験と、完全に同時刻の保存の排他試験は含まない**
- [ ] **Phase 1F ブランチを Netlify のプレビューにデプロイし、docs/netlify-cache-verification.md の手順 4（キャッシュ確認 11 項目）を実施**（特に 2 キャッシュヒット、5 キー=repo のみ、7 エラー非キャッシュ。不合格ならキャッシュを戻す）
- [ ] Issue/PR 番号の入力例・説明の表示を実環境で確認
- [ ] Netlify 管理画面で、プラン・月間利用枠・Functions 使用量・超過時の動作・追加請求の可能性・利用可能なアクセス制限・レート制限の可否を確認（docs/netlify-cache-verification.md 5 章。家主が確認し、設定変更は承認後）
- [ ] リリース対象コミット（マージ後の main）を Netlify にデプロイして主要操作を再確認
- [ ] `ALLOWED_REPOS` を本番の意図どおりに設定（未設定時は `pofuru-web/ai-dev-lab-public` のみ）
- [ ] `GITHUB_TOKEN` を使うかどうかの判断（使う場合は別途動作確認。現状は未検証）
- [ ] Netlify のビルド Node バージョンの確認（固定していない）
- [ ] スマホ実機・Chromium 以外のブラウザでの確認（未実施）

## C. レビュー指摘（docs/review-v0.1.md）
- [x] High: 0 件。Medium: M-1・M-2・M-3・M-5 は Phase 1E で修正済み（自動テスト済み、実環境は未確認）
- [ ] **M-4（公開 Function）**: Phase 1F で CDN キャッシュのみ実装（軽減。Netlify 上は未検証、アクセス制限ではない）。実環境確認の結果を踏まえ、残存リスク（悪意ある呼び出しによる利用枠の消費、キー変更によるキャッシュ回避、許可リスト変更後の最大60秒の旧キャッシュ）を既知の制約として受け入れるか、アクセス制限（要プラン確認）を追加するかを家主が決定
- [x] 回帰テスト（Vitest 166 / Playwright 29 以上）を再実行 — 219 / 48 成功
- [x] Low のうち確認ダイアログ、破損データの控え、Node 指定は修正済み
- [ ] 残りの Low（ErrorBoundary、CSP ヘッダー、モーダルの操作性、控えのダウンロード画面など）を既知の制約として受け入れるか決定

## D. ドキュメント
- [x] README.md、docs/user-guide.md、docs/release-notes-v0.1.md、docs/release-checklist.md、docs/review-v0.1.md、docs/function-protection-options.md を整備・更新（Phase 1E）
- [x] 設計書と実装の不一致（キャッシュヘッダー、ETag、旧データモデルの断り書き、mvp-scope）を修正
- [ ] 家主による文書レビュー（Phase 1F で docs/netlify-cache-verification.md、docs/release-procedure.md を追加）

## E. 承認・リリース手続き（家主の承認後にのみ実施）
- [ ] 家主の承認
- [ ] PR 作成（未作成。手順案: docs/release-procedure.md）
- [ ] main へのマージ（未実施）
- [ ] Netlify の本番ブランチを main に戻す（手順案: docs/release-procedure.md。実際の現在設定は未確認）
- [ ] リリースタグ作成（未作成。手順案あり）
- [ ] 正式リリースの宣言

## F. 運用前の注意（家主向け）
- [ ] 初回利用前に「データ管理」でバックアップを取得
- [ ] 複数タブで使わない運用の周知（同時刻保存の制約）

# AI Dev Control v0.1

複数プロジェクトの開発状況を、**AI（Claude Code Web / Codex Cloud など）を担当者として**管理する Web アプリです。最終承認者は人間（家主）で、AI は開発・レビュー担当です。

> 状態: v0.1 は**リリース前（家主の承認待ち）**です。公式リリース・タグ・main へのマージは行われていません。実装範囲と制約は [docs/release-notes-v0.1.md](docs/release-notes-v0.1.md) を参照してください。

## 概要

- データ（プロジェクト・担当者・タスク・作業時間）は**ブラウザの localStorage にのみ**保存されます。サーバーには保存されません。
- GitHub は**読み取り専用（GET のみ）**。手動で同期したときだけ、公開リポジトリの Issue / PR / Commit（各最新30件）を取得します。自動同期はありません。
- 認証機能はありません（個人利用前提）。非公開リポジトリは対象外です。
- 作業時間は手入力のみ。GitHub の履歴から稼働時間を推測しません。

構成: Vite + React + TypeScript、Tailwind CSS、Netlify Functions、localStorage、Vitest + Playwright。

## ドキュメント

| 文書 | 内容 |
|---|---|
| [docs/user-guide.md](docs/user-guide.md) | 基本操作、バックアップ・復元、競合発生時の対処 |
| [docs/release-notes-v0.1.md](docs/release-notes-v0.1.md) | 実装済み機能、既知の制約、未実装機能 |
| [docs/release-checklist.md](docs/release-checklist.md) | リリース前の確認事項 |
| [docs/review-v0.1.md](docs/review-v0.1.md) | Phase 1D の全体レビュー・セキュリティレビュー結果 |
| [docs/architecture.md](docs/architecture.md) / [data-model.md](docs/data-model.md) / [github-integration.md](docs/github-integration.md) / [mvp-scope.md](docs/mvp-scope.md) / [test-plan.md](docs/test-plan.md) | 設計・データモデル・GitHub 連携・範囲・テスト計画 |

## 開発・起動

要件: Node.js 22 系で開発・検証しています（`engines` や `.nvmrc` は未設定）。

```bash
npm install
npm run dev        # 開発サーバー（Vite）
```

注意: `npm run dev` や `vite preview` は **Netlify Function を提供しません**。`/api/github-snapshot` は画面（HTML）を返すため、ローカルでは「GitHub同期」が失敗します（`vite preview` で実測済み）。同期まで試すには Netlify 上のデプロイ（プレビュー可）を使ってください。`netlify dev` は未検証です。

## 検証コマンド

```bash
npm run typecheck
npm run lint
npm test            # Vitest（単体・結合）
npm run build
npm run test:e2e    # Playwright（ビルドして preview を起動します）
```

ブラウザが事前インストール済みの環境では `PW_CHROMIUM_PATH=/path/to/chromium npm run test:e2e` で再利用できます。E2E の GitHub 通信はモックです。

## デプロイ（Netlify）

`netlify.toml` に設定済みです。

| 項目 | 値 |
|---|---|
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Function 公開パス | `/api/github-snapshot` |

デプロイ手順（概要）: リポジトリを Netlify に接続し、対象ブランチをデプロイします。Netlify 上での動作は、Phase 1A〜1C の各コミットを家主が実環境で確認済みです（詳細は docs/test-plan.md。家主の報告であり、Claude Code が実行したものではありません）。

## 環境変数（Netlify のサイト設定。サーバー側のみ）

| 変数 | 必須 | 説明 |
|---|---|---|
| `ALLOWED_REPOS` | 任意 | 取得を許可する `owner/name` のカンマ区切りリスト（大文字小文字は区別しない）。**未設定時は `pofuru-web/ai-dev-lab-public` のみ**許可。 |
| `GITHUB_TOKEN` | 任意 | GitHub API のレート制限を引き上げるためのトークン。未設定なら未認証（60回/時間）。**設定した場合の動作は未検証**です。 |

`VITE_` で始まる変数にトークンを入れないでください（ブラウザ向けバンドルに含まれます）。`.env.example` を参照してください。

## セキュリティ上の注意

- Function は認証なしで公開されます。許可リスト外のリポジトリは 403、GitHub への呼び出しは GET のみです。それでも誰でも呼び出せるため、レート制限を消費される可能性があります（docs/review-v0.1.md の指摘 M-4）。
- トークンはサーバー環境変数のみで扱い、ブラウザには渡りません。

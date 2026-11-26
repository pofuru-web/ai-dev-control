# CDN キャッシュの実環境確認手順と、Netlify 管理画面での確認事項（家主向け）

**状態: Claude Code Web は Netlify の実環境にアクセスできないため、以下はすべて未検証です。** 実装（Phase 1F）は自動テストで確認済みですが、「Netlify の CDN が実際にこのヘッダーでキャッシュするか」は家主の確認が必要です。Netlify の仕様の記述は公式ドキュメントの検索結果の要約に基づきます（リンクは末尾）。

## 1. 実装の内容（Phase 1F）
`src/lib/github/handler.ts` が付けるヘッダー:

| 応答 | `Netlify-CDN-Cache-Control` | `Cache-Control`（ブラウザ向け） | `Netlify-Vary` |
|---|---|---|---|
| 同期成功（200） | `public, max-age=60` | `public, max-age=0, must-revalidate` | `query=repo` |
| すべてのエラー・405 | `no-store` | `no-store` | `query=repo` |

- キャッシュキー: Netlify の現行ドキュメントでは、Function 応答はクエリ文字列を既定でキーに含み、`Netlify-Vary: query=repo` で `repo` のみに限定できる。**`repo` だけをキーにする**ことで、リポジトリが混ざらず、無関係なパラメータの追加でキャッシュを回避されにくくする。同じ URL の応答は `Netlify-Vary` が常に同一である必要があるため、エラーにも付けている。古い情報（旧ブログ・フォーラム）には「クエリ文字列は無視される」という記述もあり、現行ドキュメントと食い違う。**どちらが家主のサイトで正しいかは手順 4-5 で実測してください。**
- エラーのキャッシュ: Netlify が `Netlify-CDN-Cache-Control` 付きの 4xx/5xx をキャッシュするかを明記した記述は見つけられなかったため、エラーには明示的に `no-store` を付けた。
- ブラウザ: 毎回再検証（検証用の ETag がないため実質毎回再取得）。長時間保持しない。
- `durable` は使っていない（エッジごとに別キャッシュ。簡素さを優先）。

## 2. 許可リストとキャッシュの関係（重要）
- **キャッシュヒットは Function を実行せずに CDN が返す**（公式ドキュメント）。したがって許可判定はヒット時には行われない。キャッシュに入るのは「許可されたリポジトリの成功応答」だけ（許可外・不正入力は 4xx でキャッシュされない）。
- `ALLOWED_REPOS` からリポジトリを外した後も、**最大 60 秒間**は旧キャッシュが返り得る。公式ドキュメントでは新しいデプロイごとにキャッシュが破棄される。環境変数の変更が自動で再デプロイを起こすかは未確認のため、変更後は再デプロイするのが確実。
- キャッシュは**アクセス制限でも認証の代替でもない**。大文字小文字だけ違う URL（`repo=POFURU-WEB/...`）は別のキーになり、許可リストは大文字小文字を区別しないため通る。つまり悪意のある呼び出しは、キーを変えれば Function と GitHub に届く。**利用枠の消費を完全には防げない**。

## 3. 利用者への影響
- 手動同期でも、直前の同期から 60 秒以内は同じ内容が返り、「最終取得日時」が更新されないことがある（画面に説明を表示。この時刻は GitHub から実際に取得した時刻）。API 残量表示もキャッシュ時点の値。
- 60 秒待ってから再同期すれば最新になる。

## 4. Netlify プレビューでの確認手順
前提: Phase 1F のブランチを Netlify のプレビュー（またはブランチデプロイ）にデプロイする。以降 `$URL` はそのデプロイの URL。**プレビューの URL は本番と別オリジンなので、ブラウザ内のデータ（localStorage）は共有されない**（空の状態から始まる。既存データの確認は本番 URL か、バックアップの復元で行う）。

ヘッダーを見るには `HEAD` ではなく **GET** を使う（このアプリは HEAD を 405 で拒否する）。

```bash
URL="https://<プレビューのURL>"
REPO="pofuru-web/ai-dev-lab-public"
# 1回取得: ヘッダーと、fetchedAt・rateLimit.remaining を表示
fetch() { curl -s -D /tmp/h.txt "$URL/api/github-snapshot?repo=$1" -o /tmp/b.json; grep -iE '^(HTTP|cache-status|netlify-cdn-cache-control|cache-control|netlify-vary|age)' /tmp/h.txt; python3 -c "import json;d=json.load(open('/tmp/b.json'));s=d.get('snapshot') or {};print('ok=',d.get('ok'),'repo=',s.get('repo'),'fetchedAt=',s.get('fetchedAt'),'remaining=',(s.get('rateLimit') or {}).get('remaining'))"; }
```

| # | 確認項目 | 手順 | 期待結果（合格条件） |
|---|---|---|---|
| 1 | 初回同期が成功する | `fetch $REPO`（または画面で「手動で同期」） | HTTP 200、`ok= True`、ヘッダーに `netlify-cdn-cache-control: public, max-age=60` と `netlify-vary: query=repo`。`cache-status` はキャッシュミスを示す（表記は Netlify 仕様。例: `fwd=miss`） |
| 2 | 期間内の再同期でキャッシュが使われる | 1の直後（60秒以内）にもう一度 `fetch $REPO` | `fetchedAt` が**1回目と同一**。`cache-status` がヒットを示す |
| 3 | ヒット時に Function 実行が省略される | Netlify 管理画面の Functions のログ/メトリクスで `github-snapshot` の実行回数を、1・2 の前後で比較 | 2回目で実行回数が増えない（＝ヒット）。確認画面の場所は 5 章参照 |
| 4 | GitHub API の消費が減る | 未認証の場合、`rateLimit.remaining` は 1 回の取得（キャッシュミス）で 4 減る想定。1回目と2回目で比較 | 2回目は `remaining` が同じ（消費なし）。**他の利用者と送信元 IP を共有している場合、他者の消費で値が動くため、単独の判断材料にしない（推測）** |
| 5 | キャッシュキーが repo のみ | `curl ... "$URL/api/github-snapshot?repo=$REPO&x=1"` | `fetchedAt` が2と同一（余計なパラメータがキーに影響しない）。もし別の `fetchedAt` なら、`Netlify-Vary` の効き方が想定と異なるので **報告して採用を止める** |
| 6 | 期限後に最新情報が取得される | 60 秒以上待って `fetch $REPO` | `fetchedAt` が更新される |
| 7 | エラーがキャッシュされない | `fetch other/repo`（許可外 → 403）を2回、`curl -s -D - "$URL/api/github-snapshot?repo=../x" -o /dev/null`（400）を2回、`curl -s -D - -I "$URL/api/github-snapshot?repo=$REPO"`（HEAD → 405）を2回 | すべて `cache-control: no-store`。`cache-status` がヒットにならない。**404/429/5xx は意図的に起こせないため未確認として残る**（許可リストに存在しないリポジトリを足す必要があるため） |
| 8 | 異なるリポジトリが混在しない | 許可リストに2つ目の公開リポジトリを**家主が**追加できる場合のみ: `fetch <2つ目>` が別の `repo` / 内容を返す。追加しない場合は代替として `fetch POFURU-WEB/AI-DEV-LAB-PUBLIC`（大文字）が別キーとして新しい `fetchedAt` を返すことを確認 | 内容の混在なし（各応答の `repo` が要求どおり） |
| 9 | 許可外リポジトリが拒否される | `fetch other/repo` | HTTP 403、`ok= False`。キャッシュされていない |
| 10 | ブラウザの再取得 | 画面で連続して2回「手動で同期」 | 2回目の「最終取得日時」が変わらない場合があること、説明文が表示されること |
| 11 | 許可リスト変更後の旧キャッシュ（任意） | `ALLOWED_REPOS` を変更→再デプロイ→直後に旧リポジトリを要求 | 403（デプロイでキャッシュが破棄される想定。**未確認**） |

合格しない項目がある場合（特に 2・5・7）は、キャッシュを無効化する（このコミットを戻して再デプロイ）ことを推奨します。

## 5. Netlify 管理画面で家主が確認すること（推測で断定していません）
メニュー名・場所は Netlify の更新で変わるため、公式ドキュメントも併せて参照してください。**確認だけで、設定の変更は家主の判断で行います（Claude Code は変更していません）。**

| 確認事項 | 見る場所（目安。未確認） | 見るポイント |
|---|---|---|
| 現在の契約プラン | Team settings / Billing | プラン名と、クレジット制か旧体系か（公式ドキュメント上、2025年9月4日以前のプロジェクトは旧体系の記載あり） |
| 月間の利用枠 | Billing / Usage | クレジット制: 月のクレジット総量。旧体系: Function 呼び出し回数などの上限 |
| Functions の使用量 | Usage、サイトの Logs & metrics → Functions | `github-snapshot` の実行回数、今月の消費、手順 4-3 の前後比較 |
| 利用枠超過時の動作 | Usage / Billing の説明、プラン比較ページ | 公式ドキュメントでは Free のクレジット制は上限に達するとプロジェクトが次の請求サイクルまで停止し、費用は発生しないとされる。**家主のプランで同じかは未確認** |
| 追加請求の可能性 | Billing の「自動チャージ（auto recharge）」等 | 自動チャージが有効か、上限額。有効な場合は超過で費用が発生し得る（未確認） |
| 無料で使えるアクセス制限 | サイトの Project visibility / Access control | 公式ドキュメントでは、パスワード保護は Pro 以上、クレジット制の Free/Personal では「プロジェクトを非公開にする」が推奨とされる。家主のプランで使えるか・追加費用の有無は未確認 |
| レート制限の利用可否 | サイトの Security / Rate limiting | 公式ドキュメントではコード内で `rateLimit` を設定でき、Free/Starter/Personal は1プロジェクト2ルールまで。家主のプランでの可否・挙動は未確認（今回は導入しない） |
| 本番ブランチ | Site configuration → Build & deploy → Branches | 本番ブランチが現在どれか（main へ戻す手順は docs/release-procedure.md） |
| Node のバージョン | デプロイログの冒頭 | `.nvmrc`（22）が使われているか（Phase 1E の受入で家主が確認済み） |

## 出典（公式ドキュメント。検索結果で確認した範囲）
- [Caching overview](https://docs.netlify.com/build/caching/caching-overview/)
- [Netlify Cache Key Variations](https://www.netlify.com/blog/netlify-cache-key-variations/)
- [How to control CDN caching on Netlify](https://www.netlify.com/knowledge-base/how-to-control-cdn-caching-on-netlify/)
- [Rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [Credit-based pricing plans](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/credit-based-pricing-plans/)
- [Password Protection overview](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/)
- [Project visibility](https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/)
- [Available software at build time](https://docs.netlify.com/build/configure-builds/available-software-at-build-time/)
